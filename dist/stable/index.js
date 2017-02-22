'use strict';

const assert = require('assert');
const babylon = require('babylon');
const tt = babylon.tokTypes;

var _g_offsidePluginOpts;
const default_offsidePluginOpts = { keyword_blocks: true };

const _base_module_parse = babylon.parse;
babylon.parse = (input, options) => {
  _g_offsidePluginOpts = options ? options.offsidePluginOpts : undefined;
  return _base_module_parse(input, options);
};

const Parser = hookBabylon();
const baseProto = Parser.prototype;
const pp = Parser.prototype = Object.create(baseProto);

function hookBabylon() {
  // abuse Babylon token updateContext callback extract
  // the reference to Parser

  let Parser;
  let tgt_patch = babylon.tokTypes.braceL;
  let fn_updateContext = tgt_patch.updateContext;
  tgt_patch.updateContext = function (prevType) {
    tgt_patch.updateContext = fn_updateContext;
    Parser = this.constructor;
  };

  babylon.parse('{}');
  if (!Parser) throw new Error("Failed to hook Babylon Parser");
  return Parser;
}

pp._base_parse = baseProto.parse;
pp.parse = function () {
  this.initOffside();
  return this._base_parse();
};

class OffsideBreakout extends Error {}
const offsideBreakout = new OffsideBreakout();

pp.initOffside = function () {
  this.state.offside = [];
  this.state.offsideNextOp = null;
  this.offside_lines = parseOffsideIndexMap(this.input);
  this.offsidePluginOpts = _g_offsidePluginOpts || default_offsidePluginOpts;
  _g_offsidePluginOpts = null;

  this.state._pos = this.state.pos;
  Object.defineProperty(this.state, 'pos', { enumerable: true,
    get() {
      return this._pos;
    }, set(pos) {
      // interrupt skipSpace algorithm when we hit our position 'breakpoint'
      let offPos = this.offsidePos;
      if (offPos >= 0 && pos > offPos) throw offsideBreakout;

      this._pos = pos;
    } });
};

let tt_offside = { '{': tt.braceL, '}': tt.braceR,
  '(': tt.parenL, ')': tt.parenR,
  '[': tt.bracketL, ']': tt.bracketR };

let tt_offside_keyword_with_args = new Set([tt._if, tt._while, tt._for, tt._catch, tt._switch]);

let tt_offside_keyword_with_block = new Set([tt._try, tt._finally, tt._else, tt._do]);

let at_offside = { '::': { tokenPre: '{', tokenPost: '}', nestInner: false, codeBlock: true },
  '::@': { tokenPre: '(', tokenPost: ')', nestInner: false, extraChars: 1 },
  '::()': { tokenPre: '(', tokenPost: ')', nestInner: false, extraChars: 2 },
  '::{}': { tokenPre: '{', tokenPost: '}', nestInner: false, extraChars: 2 },
  '::[]': { tokenPre: '[', tokenPost: ']', nestInner: false, extraChars: 2 },
  '@': { tokenPre: '(', tokenPost: ')', nestInner: true },
  '@()': { tokenPre: '{', tokenPost: '}', nestInner: true, extraChars: 2 },
  '@{}': { tokenPre: '{', tokenPost: '}', nestInner: true, extraChars: 2 },
  '@[]': { tokenPre: '[', tokenPost: ']', nestInner: true, extraChars: 2 }
  // note:  no '@()' -- standardize to use single-char '@ ' instead
  , keyword_args: { tokenPre: '(', tokenPost: ')', nestInner: false, inKeywordArg: true },
  keyword_lint: { tokenPre: '(', tokenPost: ')', nestInner: false, inKeywordArg: true } };

pp._base_parseParenExpression = baseProto.parseParenExpression;
pp.parseParenExpression = function () {
  try {
    return this._base_parseParenExpression();
  } catch (err) {
    if (!this.offsidePluginOpts.keyword_blocks) {
      throw err;
    }

    const stack = this.state.offside;
    const stackTop = stack[stack.length - 1];
    if (!stackTop || !stackTop.inKeywordArg) {
      throw err;
    }
    if (!err.message.startsWith('Unexpected token, expected )')) {
      throw err;
    }

    this.raise(stackTop.first.posLastContent, `Keyword with arguments should be followed by a code block. ('::' or '{}')`);
  }
};

pp._base_finishToken = baseProto.finishToken;
pp.finishToken = function (type, val) {
  this.state.offsideRecentOp = null;

  const isLookahead = this.isLookahead;
  if (!isLookahead && tt_offside_keyword_with_args.has(type)) {
    const lookahead = this.lookahead();
    if (tt.parenL !== lookahead.type) {
      this.state.offsideNextOp = at_offside.keyword_args;
    } else if (lookahead.offsideRecentOp === at_offside['@']) {
      this.state.offsideNextOp = at_offside.keyword_args;
    } else if (this.offsidePluginOpts.keyword_blocks) {
      if (tt._catch === type) {
        // the following linting approach doesn't work for catch statements
      } else {
          this.state.offsideNextOp = at_offside.keyword_lint;
        }
    }

    return this._base_finishToken(type, val);
  }

  if (!isLookahead && tt_offside_keyword_with_block.has(type)) {
    if (this.offsidePluginOpts.keyword_blocks) {
      const lookahead = this.lookahead();
      if (tt.braceL !== lookahead.type && tt._if !== lookahead.type) {
        this.raise(this.state.pos, `Keyword "${type.label}" should be followed by a code block. ('::' or '{}' or 'if')`);
      }
    }

    return this._base_finishToken(type, val);
  }

  if (type === tt.at || type === tt.doubleColon) {
    const pos0 = this.state.start,
          pos1 = this.state.pos + 2;
    const str_op = this.input.slice(pos0, pos1).split(/\s/, 1)[0];

    const op = at_offside[str_op];
    if (op) {
      return this.finishOffsideOp(op);
    }
  }

  if (tt.eof === type) {
    if (this.state.offside.length) {
      return this.popOffside();
    }
  }

  return this._base_finishToken(type, val);
};

pp.offsideBlock = function (op, stackTop) {
  let offside_lines = this.offside_lines;

  const line0 = this.state.curLine;
  const first = offside_lines[line0];
  const nestInner = op.nestInner && stackTop && line0 === stackTop.first.line;
  const indent = nestInner ? stackTop.innerIndent : first.indent;
  let line = 1 + line0,
      last = first;
  let innerIndent = offside_lines[line].indent;

  while (line < offside_lines.length) {
    let cur = offside_lines[line];
    if (cur.content && indent >= cur.indent) {
      break;
    }

    line++;last = cur;
    if (innerIndent > cur.indent) {
      innerIndent = cur.indent;
    }
  }

  // cap to 
  innerIndent = first.indent > innerIndent ? first.indent : innerIndent;

  return { op, innerIndent, first, last, nestInner };
};

pp.finishOffsideOp = function (op) {
  this.state.offsideRecentOp = op;
  const stack = this.state.offside;
  let stackTop = stack[stack.length - 1];
  if (stackTop && stackTop.inKeywordArg && op.codeBlock) {
    this.popOffside();
    this.state.offsideNextOp = op;
    return;
  }

  if (op.extraChars) {
    this.state.pos += op.extraChars;
  }

  this._base_finishToken(tt_offside[op.tokenPre]);

  if (this.isLookahead) {
    return;
  }

  stackTop = stack[stack.length - 1];
  let blk = this.offsideBlock(op, stackTop);
  blk.inKeywordArg = op.inKeywordArg || stackTop && stackTop.inKeywordArg;
  this.state.offside.push(blk);
};

pp._base_skipSpace = baseProto.skipSpace;
pp.skipSpace = function () {
  if (null !== this.state.offsideNextOp) {
    return;
  }

  const stack = this.state.offside;
  let stackTop;
  if (stack && stack.length) {
    stackTop = stack[stack.length - 1];
    this.state.offsidePos = stackTop.last.posLastContent;
  } else {
    this.state.offsidePos = -1;
  }

  try {
    this._base_skipSpace();
    this.state.offsidePos = -1;
  } catch (err) {
    if (err !== offsideBreakout) throw err;
  }
};

pp._base_readToken = baseProto.readToken;
pp.readToken = function (code) {
  const offsideNextOp = this.state.offsideNextOp;
  if (null !== offsideNextOp) {
    this.state.offsideNextOp = null;
    return this.finishOffsideOp(offsideNextOp);
  } else if (this.state.pos === this.state.offsidePos) {
    return this.popOffside();
  } else {
    return this._base_readToken(code);
  }
};

pp.popOffside = function () {
  const stack = this.state.offside;
  let stackTop = this.isLookahead ? stack[stack.length - 1] : stack.pop();
  this.state.offsidePos = -1;

  const op = stackTop.op;
  const tt_post = tt_offside[op.tokenPost];
  this._base_finishToken(tt_post);
  return stackTop;
};

const rx_offside = /^([ \t]*)(.*)$/mg;
function parseOffsideIndexMap(input) {
  let lines = [null],
      posLastContent = 0,
      last = ['', 0];

  let ans = input.replace(rx_offside, (match, indent, content, pos) => {
    if (!content) {
      [indent, posLastContent] = last; // blank line; use last valid content as end
    } else {
        // valid content; set last to current indent
        posLastContent = pos + match.length;
        last = [indent, posLastContent];
      }

    lines.push({ line: lines.length, posLastContent, indent, content });
    return '';
  });

  return lines;
}

const babel_plugin_id = `babel-plugin-offside--${Date.now()}`;
module.exports = exports = babel => {
  return {
    name: babel_plugin_id,
    manipulateOptions(opts, parserOpts) {
      parserOpts.plugins.push('decorators', 'functionBind');
      parserOpts.offsidePluginOpts = opts.plugins.filter(plugin => plugin[0] && babel_plugin_id === plugin[0].key).pop()[1];
    } };
};

Object.assign(exports, {
  hookBabylon,
  parseOffsideIndexMap });
//# sourceMappingURL=index.js.map