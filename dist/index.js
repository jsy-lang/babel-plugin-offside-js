const babylon = require('babylon');
const tt = babylon.tokTypes;

var _g_offsidePluginOpts;
const default_offsidePluginOpts = { check_blocks: /\/node_modules\/|\\node_modules\\/ };

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
  if (!Parser) {
    throw new Error("Failed to hook Babylon Parser");
  }
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
  this.offsidePluginOpts = _g_offsidePluginOpts || {};
  _g_offsidePluginOpts = null;

  this.state._pos = this.state.pos;
  Object.defineProperty(this.state, 'pos', { enumerable: true,
    get() {
      return this._pos;
    }, set(pos) {
      // interrupt skipSpace algorithm when we hit our position 'breakpoint'
      let offPos = this.offsidePos;
      if (offPos >= 0 && pos > offPos) {
        throw offsideBreakout;
      }

      this._pos = pos;
    } });
};

let tt_offside_keyword_with_args = new Set([tt._if, tt._while, tt._for, tt._catch, tt._switch]);

let tt_offside_keyword_lookahead_skip = new Set([tt.parenL, tt.colon, tt.comma, tt.dot]);

let at_offside = { '::': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: false, codeBlock: true },
  '::@': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, extraChars: 1 },
  '::()': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, extraChars: 2 },
  '::{}': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: false, extraChars: 2 },
  '::[]': { tokenPre: tt.bracketL, tokenPost: tt.bracketR, nestInner: false, extraChars: 2 },
  '@': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: true, keywordBlock: true },
  '@:': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestOp: '::{}', nestInner: false, keywordBlock: true },
  '@()': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: true, extraChars: 2 },
  '@{}': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: true, extraChars: 2 },
  '@[]': { tokenPre: tt.bracketL, tokenPost: tt.bracketR, nestInner: true, extraChars: 2 }
  // note:  no '@()' -- standardize to use single-char '@ ' instead
  , keyword_args: { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, inKeywordArg: true } };

pp.isForAwait = function (keywordType, type, val) {
  return tt._for === keywordType && tt.name === type && 'await' === val;
};

pp._base_finishToken = baseProto.finishToken;
pp.finishToken = function (type, val) {
  const state = this.state;
  const recentKeyword = state.offsideRecentKeyword;
  let inForAwait = recentKeyword ? this.isForAwait(recentKeyword, type, val) : null;
  state.offsideRecentKeyword = null;

  if (tt_offside_keyword_with_args.has(type) || inForAwait) {
    let isKeywordAllowed = !this.isLookahead && tt.dot !== state.type;

    if (!isKeywordAllowed) {
      return this._base_finishToken(type, val);
    }

    state.offsideRecentKeyword = inForAwait ? tt._for : type;
    const lookahead = this.lookahead();

    if (tt_offside_keyword_lookahead_skip.has(lookahead.type)) {} else if (this.isForAwait(type, lookahead.type, lookahead.value)) {} else {
      state.offsideNextOp = at_offside.keyword_args;
    }

    return this._base_finishToken(type, val);
  }

  if (type === tt.at || type === tt.doubleColon) {
    const pos0 = state.start,
          pos1 = state.pos + 2;
    const str_op = this.input.slice(pos0, pos1).split(/\s/, 1)[0];

    let op = at_offside[str_op];
    if (op.keywordBlock && recentKeyword && tt_offside_keyword_with_args.has(recentKeyword)) {
      op = at_offside.keyword_args;
    }

    if (op.nestOp) {
      state.offsideNextOp = at_offside[op.nestOp];
    }
    if (op) {
      return this.finishOffsideOp(op);
    }
  }

  if (tt.eof === type) {
    if (state.offside.length) {
      return this.popOffside();
    }
  }

  return this._base_finishToken(type, val);
};

pp.offsideIndent = function (line0, outerIndent, innerIndent) {
  const offside_lines = this.offside_lines;

  if (null == innerIndent) {
    const innerLine = offside_lines[line0 + 1];
    innerIndent = innerLine ? innerLine.indent : '';
  }

  let line = line0 + 1,
      last = offside_lines[line0];
  while (line < offside_lines.length) {
    const cur = offside_lines[line];
    if (cur.content && outerIndent >= cur.indent) {
      line--; // backup to previous line
      break;
    }

    line++;last = cur;
    if (innerIndent > cur.indent) {
      innerIndent = cur.indent;
    }
  }

  return { line, last, innerIndent };
};

pp.offsideBlock = function (op, stackTop, recentKeywordTop) {
  let offside_lines = this.offside_lines;

  const line0 = this.state.curLine;
  const first = offside_lines[line0];

  let indent, keywordNestedIndent;
  if (recentKeywordTop) {
    indent = recentKeywordTop.first.indent;
  } else if (op.nestInner && stackTop && line0 === stackTop.first.line) {
    indent = stackTop.innerIndent;
  } else if (op.inKeywordArg) {
    indent = first.indent;
    const indent_block = this.offsideIndent(line0, indent);
    const indent_keyword = this.offsideIndent(line0, indent_block.innerIndent);
    if (indent_keyword.innerIndent > indent_block.innerIndent) {
      // autodetect keyword argument using '@' for function calls
      indent = indent_block.innerIndent;
      keywordNestedIndent = indent_keyword.innerIndent;
    }
  } else {
    indent = first.indent;
  }

  let { last, innerIndent } = this.offsideIndent(line0, indent, keywordNestedIndent);

  // cap to 
  innerIndent = first.indent > innerIndent ? first.indent : innerIndent;

  if (stackTop && stackTop.last.posLastContent < last.posLastContent) {
    // Fixup enclosing scopes. Happens in situations like: `server.on @ wraper @ (...args) => ::`
    const stack = this.state.offside;
    for (let idx = stack.length - 1; idx > 0; idx--) {
      let tip = stack[idx];
      if (tip.last.posLastContent >= last.posLastContent) {
        break;
      }
      tip.last = last;
    }
  }

  return { op, innerIndent, first, last };
};

pp.finishOffsideOp = function (op) {
  const stack = this.state.offside;
  let stackTop = stack[stack.length - 1];
  let recentKeywordTop;
  if (op.codeBlock) {
    if (stackTop && stackTop.inKeywordArg) {
      this.popOffside();
      this.state.offsideNextOp = op;
      this.state.offsideRecentTop = stackTop;
      return;
    }

    recentKeywordTop = this.state.offsideRecentTop;
    this.state.offsideRecentTop = null;
  }

  if (op.extraChars) {
    this.state.pos += op.extraChars;
  }

  this._base_finishToken(op.tokenPre);

  if (this.isLookahead) {
    return;
  }

  stackTop = stack[stack.length - 1];
  let blk = this.offsideBlock(op, stackTop, recentKeywordTop);
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
    if (err !== offsideBreakout) {
      throw err;
    }
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

  this._base_finishToken(stackTop.op.tokenPost);
  return stackTop;
};

const rx_offside = /^([ \t]*)(.*)$/mg;
function parseOffsideIndexMap(input) {
  let lines = [null],
      posLastContent = 0,
      last = ['', 0];
  let idx_lastContent = 0;

  let ans = input.replace(rx_offside, (match, indent, content, pos) => {
    if (!content) {
      [indent, posLastContent] = last; // blank line; use last valid content as end
    } else {
        // valid content; set last to current indent
        posLastContent = pos + match.length;
        idx_lastContent = lines.length;
        last = [indent, posLastContent];
      }
    lines.push({ line: lines.length, posLastContent, indent, content });
    return '';
  });

  lines.splice(1 + idx_lastContent); // trim trailing whitespace
  return lines;
}

const babel_plugin_id = `babel-plugin-offside--${Date.now()}`;

const isNodeModuleDependency = aFilePath => /\/node_modules\/|\\node_modules\\/.test(aFilePath);
module.exports = exports = babel => {
  return {
    name: babel_plugin_id,
    pre(state) {
      this.opts = Object.assign({}, default_offsidePluginOpts, this.opts);

      let check_blocks = this.opts.check_blocks;
      if (check_blocks instanceof Function) {
        check_blocks = check_blocks(state.opts.filename);
      } else if (check_blocks instanceof RegExp) {
        check_blocks = !check_blocks.test(state.opts.filename);
      } else if ('string' === typeof check_blocks) {
        check_blocks = !new RegExp(check_blocks).test(state.opts.filename);
      }

      this.opts.check_blocks = check_blocks = !!check_blocks;
    }

    //, post(state) :: console.dir @ state.ast.program, @{} colors: true, depth: null

    , manipulateOptions(opts, parserOpts) {
      parserOpts.plugins.push('asyncGenerators', 'classProperties', 'decorators', 'functionBind');
      const offsidePluginOpts = opts.plugins.filter(plugin => plugin[0] && babel_plugin_id === plugin[0].key && plugin[1]).map(plugin => plugin[1]).pop();
      parserOpts.offsidePluginOpts = offsidePluginOpts || default_offsidePluginOpts;
    }, visitor: {
      Program(path) {
        if (this.opts.check_blocks) {
          ensureConsistentBlockIndent(path, path.node.body);
        }
      }, BlockStatement(path) {
        if (this.opts.check_blocks) {
          ensureConsistentBlockIndent(path, path.node.body);
        }
      }, SwitchStatement(path) {
        if (this.opts.check_blocks) {
          ensureConsistentBlockIndent(path, path.node.cases);
        }
      }, SwitchCase(path) {
        if (this.opts.check_blocks) {
          ensureConsistentBlockIndent(path, path.node.consequent);
        }
      } } };
};

function ensureConsistentBlockIndent(path, body) {
  if (null == body) {
    body = path.node.body;
  }
  body = Array.from(body);
  if (!body || !body.length) {
    return;
  }

  let prev_line,
      block_column = null;
  for (const child of body) {
    const loc = child.loc;
    if (!loc) {
      // A synthetic child often does not have a location.
      // Furthermore, a synthetic child indicates that something is mucking
      // around with the AST. Adapt by resetting block_column and enforcing
      // only across consecutive entries with valid locations.
      block_column = null;
      continue;
    } else if (null === block_column) {
      // assume the first location is indented properly…
      block_column = loc.start.column;
    }

    if (loc.start.line != prev_line && loc.start.column != block_column) {
      throw path.hub.file.buildCodeFrameError(child, `Indent mismatch. (block: ${block_column}, statement: ${loc.start.column}). \n` + `    (From 'check_blocks' enforcement option of babel-plugin-offside)`);
    }

    prev_line = loc.end.line;
  }
}

Object.assign(exports, {
  hookBabylon,
  parseOffsideIndexMap,
  ensureConsistentBlockIndent });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL2NvZGUvaW5kZXguanMiXSwibmFtZXMiOlsiYmFieWxvbiIsInJlcXVpcmUiLCJ0dCIsInRva1R5cGVzIiwiX2dfb2Zmc2lkZVBsdWdpbk9wdHMiLCJkZWZhdWx0X29mZnNpZGVQbHVnaW5PcHRzIiwiY2hlY2tfYmxvY2tzIiwiX2Jhc2VfbW9kdWxlX3BhcnNlIiwicGFyc2UiLCJpbnB1dCIsIm9wdGlvbnMiLCJvZmZzaWRlUGx1Z2luT3B0cyIsInVuZGVmaW5lZCIsIlBhcnNlciIsImhvb2tCYWJ5bG9uIiwiYmFzZVByb3RvIiwicHJvdG90eXBlIiwicHAiLCJPYmplY3QiLCJjcmVhdGUiLCJ0Z3RfcGF0Y2giLCJicmFjZUwiLCJmbl91cGRhdGVDb250ZXh0IiwidXBkYXRlQ29udGV4dCIsInByZXZUeXBlIiwiY29uc3RydWN0b3IiLCJFcnJvciIsIl9iYXNlX3BhcnNlIiwiaW5pdE9mZnNpZGUiLCJPZmZzaWRlQnJlYWtvdXQiLCJvZmZzaWRlQnJlYWtvdXQiLCJzdGF0ZSIsIm9mZnNpZGUiLCJvZmZzaWRlTmV4dE9wIiwib2Zmc2lkZV9saW5lcyIsInBhcnNlT2Zmc2lkZUluZGV4TWFwIiwiX3BvcyIsInBvcyIsImRlZmluZVByb3BlcnR5IiwiZW51bWVyYWJsZSIsImdldCIsInNldCIsIm9mZlBvcyIsIm9mZnNpZGVQb3MiLCJ0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzIiwiU2V0IiwiX2lmIiwiX3doaWxlIiwiX2ZvciIsIl9jYXRjaCIsIl9zd2l0Y2giLCJ0dF9vZmZzaWRlX2tleXdvcmRfbG9va2FoZWFkX3NraXAiLCJwYXJlbkwiLCJjb2xvbiIsImNvbW1hIiwiZG90IiwiYXRfb2Zmc2lkZSIsInRva2VuUHJlIiwidG9rZW5Qb3N0IiwiYnJhY2VSIiwibmVzdElubmVyIiwiY29kZUJsb2NrIiwicGFyZW5SIiwiZXh0cmFDaGFycyIsImJyYWNrZXRMIiwiYnJhY2tldFIiLCJrZXl3b3JkQmxvY2siLCJuZXN0T3AiLCJrZXl3b3JkX2FyZ3MiLCJpbktleXdvcmRBcmciLCJpc0ZvckF3YWl0Iiwia2V5d29yZFR5cGUiLCJ0eXBlIiwidmFsIiwibmFtZSIsIl9iYXNlX2ZpbmlzaFRva2VuIiwiZmluaXNoVG9rZW4iLCJyZWNlbnRLZXl3b3JkIiwib2Zmc2lkZVJlY2VudEtleXdvcmQiLCJpbkZvckF3YWl0IiwiaGFzIiwiaXNLZXl3b3JkQWxsb3dlZCIsImlzTG9va2FoZWFkIiwibG9va2FoZWFkIiwidmFsdWUiLCJhdCIsImRvdWJsZUNvbG9uIiwicG9zMCIsInN0YXJ0IiwicG9zMSIsInN0cl9vcCIsInNsaWNlIiwic3BsaXQiLCJvcCIsImZpbmlzaE9mZnNpZGVPcCIsImVvZiIsImxlbmd0aCIsInBvcE9mZnNpZGUiLCJvZmZzaWRlSW5kZW50IiwibGluZTAiLCJvdXRlckluZGVudCIsImlubmVySW5kZW50IiwiaW5uZXJMaW5lIiwiaW5kZW50IiwibGluZSIsImxhc3QiLCJjdXIiLCJjb250ZW50Iiwib2Zmc2lkZUJsb2NrIiwic3RhY2tUb3AiLCJyZWNlbnRLZXl3b3JkVG9wIiwiY3VyTGluZSIsImZpcnN0Iiwia2V5d29yZE5lc3RlZEluZGVudCIsImluZGVudF9ibG9jayIsImluZGVudF9rZXl3b3JkIiwicG9zTGFzdENvbnRlbnQiLCJzdGFjayIsImlkeCIsInRpcCIsIm9mZnNpZGVSZWNlbnRUb3AiLCJibGsiLCJwdXNoIiwiX2Jhc2Vfc2tpcFNwYWNlIiwic2tpcFNwYWNlIiwiZXJyIiwiX2Jhc2VfcmVhZFRva2VuIiwicmVhZFRva2VuIiwiY29kZSIsInBvcCIsInJ4X29mZnNpZGUiLCJsaW5lcyIsImlkeF9sYXN0Q29udGVudCIsImFucyIsInJlcGxhY2UiLCJtYXRjaCIsInNwbGljZSIsImJhYmVsX3BsdWdpbl9pZCIsIkRhdGUiLCJub3ciLCJpc05vZGVNb2R1bGVEZXBlbmRlbmN5IiwiYUZpbGVQYXRoIiwidGVzdCIsIm1vZHVsZSIsImV4cG9ydHMiLCJiYWJlbCIsInByZSIsIm9wdHMiLCJhc3NpZ24iLCJGdW5jdGlvbiIsImZpbGVuYW1lIiwiUmVnRXhwIiwibWFuaXB1bGF0ZU9wdGlvbnMiLCJwYXJzZXJPcHRzIiwicGx1Z2lucyIsImZpbHRlciIsInBsdWdpbiIsImtleSIsIm1hcCIsInZpc2l0b3IiLCJQcm9ncmFtIiwicGF0aCIsImVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudCIsIm5vZGUiLCJib2R5IiwiQmxvY2tTdGF0ZW1lbnQiLCJTd2l0Y2hTdGF0ZW1lbnQiLCJjYXNlcyIsIlN3aXRjaENhc2UiLCJjb25zZXF1ZW50IiwiQXJyYXkiLCJmcm9tIiwicHJldl9saW5lIiwiYmxvY2tfY29sdW1uIiwiY2hpbGQiLCJsb2MiLCJjb2x1bW4iLCJodWIiLCJmaWxlIiwiYnVpbGRDb2RlRnJhbWVFcnJvciIsImVuZCJdLCJtYXBwaW5ncyI6IkFBQUEsTUFBTUEsVUFBVUMsUUFBUSxTQUFSLENBQWhCO0FBQ0EsTUFBTUMsS0FBS0YsUUFBUUcsUUFBbkI7O0FBRUEsSUFBSUMsb0JBQUo7QUFDQSxNQUFNQyw0QkFDSixFQUFJQyxjQUFjLG1DQUFsQixFQURGOztBQUdBLE1BQU1DLHFCQUFxQlAsUUFBUVEsS0FBbkM7QUFDQVIsUUFBUVEsS0FBUixHQUFnQixDQUFDQyxLQUFELEVBQVFDLE9BQVIsS0FBb0I7QUFDbENOLHlCQUF1Qk0sVUFBVUEsUUFBUUMsaUJBQWxCLEdBQXNDQyxTQUE3RDtBQUNBLFNBQU9MLG1CQUFtQkUsS0FBbkIsRUFBMEJDLE9BQTFCLENBQVA7QUFBeUMsQ0FGM0M7O0FBSUEsTUFBTUcsU0FBU0MsYUFBZjtBQUNBLE1BQU1DLFlBQVlGLE9BQU9HLFNBQXpCO0FBQ0EsTUFBTUMsS0FBS0osT0FBT0csU0FBUCxHQUFtQkUsT0FBT0MsTUFBUCxDQUFjSixTQUFkLENBQTlCOztBQUVBLFNBQVNELFdBQVQsR0FBdUI7QUFDckI7QUFDQTs7QUFFQSxNQUFJRCxNQUFKO0FBQ0EsTUFBSU8sWUFBWXBCLFFBQVFHLFFBQVIsQ0FBaUJrQixNQUFqQztBQUNBLE1BQUlDLG1CQUFtQkYsVUFBVUcsYUFBakM7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QU1DLElBQU4sQ0FBV1AsSUFBWCxDQUFQO0FBQ0EsTUFBRyxDQUFDQSxJQUFELElBQVMsQ0FBQ0EsS0FBS3BFLE1BQWxCLEVBQTJCO0FBQUM7QUFBTTs7QUFFbEMsTUFBSTRFLFNBQUo7QUFBQSxNQUFlQyxlQUFhLElBQTVCO0FBQ0EsT0FBSSxNQUFNQyxLQUFWLElBQW1CVixJQUFuQixFQUEwQjtBQUN4QixVQUFNVyxNQUFNRCxNQUFNQyxHQUFsQjtBQUNBLFFBQUcsQ0FBQ0EsR0FBSixFQUFVO0FBQ1I7QUFDQTtBQUNBO0FBQ0E7QUFDQUYscUJBQWUsSUFBZjtBQUNBO0FBQVEsS0FOVixNQU9LLElBQUcsU0FBU0EsWUFBWixFQUEyQjtBQUM5QjtBQUNBQSxxQkFBZUUsSUFBSXZGLEtBQUosQ0FBVXdGLE1BQXpCO0FBQStCOztBQUVqQyxRQUFHRCxJQUFJdkYsS0FBSixDQUFVZ0IsSUFBVixJQUFrQm9FLFNBQWxCLElBQStCRyxJQUFJdkYsS0FBSixDQUFVd0YsTUFBVixJQUFvQkgsWUFBdEQsRUFBcUU7QUFDbkUsWUFBTVosS0FBS2dCLEdBQUwsQ0FBU0MsSUFBVCxDQUFjQyxtQkFBZCxDQUFvQ0wsS0FBcEMsRUFDSCw0QkFBMkJELFlBQWEsZ0JBQWVFLElBQUl2RixLQUFKLENBQVV3RixNQUFPLE9BQXpFLEdBQ0Msc0VBRkcsQ0FBTjtBQUV3RTs7QUFFMUVKLGdCQUFZRyxJQUFJSyxHQUFKLENBQVE1RSxJQUFwQjtBQUF3QjtBQUFBOztBQUc1QnRGLE9BQU9rSSxNQUFQLENBQWdCSixPQUFoQixFQUNFO0FBQ0VsSSxhQURGO0FBRUVxQixzQkFGRjtBQUdFK0gsNkJBSEYsRUFERiIsImZpbGUiOiJpbmRleC5qcyIsInNvdXJjZXNDb250ZW50IjpbImNvbnN0IGJhYnlsb24gPSByZXF1aXJlKCdiYWJ5bG9uJylcbmNvbnN0IHR0ID0gYmFieWxvbi50b2tUeXBlc1xuXG52YXIgX2dfb2Zmc2lkZVBsdWdpbk9wdHNcbmNvbnN0IGRlZmF1bHRfb2Zmc2lkZVBsdWdpbk9wdHMgPVxuICBAe30gY2hlY2tfYmxvY2tzOiAvXFwvbm9kZV9tb2R1bGVzXFwvfFxcXFxub2RlX21vZHVsZXNcXFxcL1xuXG5jb25zdCBfYmFzZV9tb2R1bGVfcGFyc2UgPSBiYWJ5bG9uLnBhcnNlXG5iYWJ5bG9uLnBhcnNlID0gKGlucHV0LCBvcHRpb25zKSA9PiA6OlxuICBfZ19vZmZzaWRlUGx1Z2luT3B0cyA9IG9wdGlvbnMgPyBvcHRpb25zLm9mZnNpZGVQbHVnaW5PcHRzIDogdW5kZWZpbmVkXG4gIHJldHVybiBfYmFzZV9tb2R1bGVfcGFyc2UoaW5wdXQsIG9wdGlvbnMpXG5cbmNvbnN0IFBhcnNlciA9IGhvb2tCYWJ5bG9uKClcbmNvbnN0IGJhc2VQcm90byA9IFBhcnNlci5wcm90b3R5cGVcbmNvbnN0IHBwID0gUGFyc2VyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoYmFzZVByb3RvKVxuXG5mdW5jdGlvbiBob29rQmFieWxvbigpIDo6XG4gIC8vIGFidXNlIEJhYnlsb24gdG9rZW4gdXBkYXRlQ29udGV4dCBjYWxsYmFjayBleHRyYWN0XG4gIC8vIHRoZSByZWZlcmVuY2UgdG8gUGFyc2VyXG5cbiAgbGV0IFBhcnNlclxuICBsZXQgdGd0X3BhdGNoID0gYmFieWxvbi50b2tUeXBlcy5icmFjZUxcbiAgbGV0IGZuX3VwZGF0ZUNvbnRleHQgPSB0Z3RfcGF0Y2gudXBkYXRlQ29udGV4dFxuICB0Z3RfcGF0Y2gudXBkYXRlQ29udGV4dCA9IGZ1bmN0aW9uIChwcmV2VHlwZSkgOjpcbiAgICB0Z3RfcGF0Y2gudXBkYXRlQ29udGV4dCA9IGZuX3VwZGF0ZUNvbnRleHRcbiAgICBQYXJzZXIgPSB0aGlzLmNvbnN0cnVjdG9yXG5cbiAgYmFieWxvbi5wYXJzZSgne30nKVxuICBpZiAoIVBhcnNlcikgOjpcbiAgICB0aHJvdyBuZXcgRXJyb3IgQCBcIkZhaWxlZCB0byBob29rIEJhYnlsb24gUGFyc2VyXCJcbiAgcmV0dXJuIFBhcnNlclxuXG5cblxucHAuX2Jhc2VfcGFyc2UgPSBiYXNlUHJvdG8ucGFyc2VcbnBwLnBhcnNlID0gZnVuY3Rpb24oKSA6OlxuICB0aGlzLmluaXRPZmZzaWRlKClcbiAgcmV0dXJuIHRoaXMuX2Jhc2VfcGFyc2UoKVxuXG5cbmNsYXNzIE9mZnNpZGVCcmVha291dCBleHRlbmRzIEVycm9yIHt9XG5jb25zdCBvZmZzaWRlQnJlYWtvdXQgPSBuZXcgT2Zmc2lkZUJyZWFrb3V0KClcblxucHAuaW5pdE9mZnNpZGUgPSBmdW5jdGlvbigpIDo6XG4gIHRoaXMuc3RhdGUub2Zmc2lkZSA9IFtdXG4gIHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCA9IG51bGxcbiAgdGhpcy5vZmZzaWRlX2xpbmVzID0gcGFyc2VPZmZzaWRlSW5kZXhNYXAodGhpcy5pbnB1dClcbiAgdGhpcy5vZmZzaWRlUGx1Z2luT3B0cyA9IF9nX29mZnNpZGVQbHVnaW5PcHRzIHx8IHt9XG4gIF9nX29mZnNpZGVQbHVnaW5PcHRzID0gbnVsbFxuXG4gIHRoaXMuc3RhdGUuX3BvcyA9IHRoaXMuc3RhdGUucG9zXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIHRoaXMuc3RhdGUsICdwb3MnLFxuICAgIEB7fSBlbnVtZXJhYmxlOiB0cnVlXG4gICAgICAsIGdldCgpIDo6IHJldHVybiB0aGlzLl9wb3NcbiAgICAgICwgc2V0KHBvcykgOjpcbiAgICAgICAgICAvLyBpbnRlcnJ1cHQgc2tpcFNwYWNlIGFsZ29yaXRobSB3aGVuIHdlIGhpdCBvdXIgcG9zaXRpb24gJ2JyZWFrcG9pbnQnXG4gICAgICAgICAgbGV0IG9mZlBvcyA9IHRoaXMub2Zmc2lkZVBvc1xuICAgICAgICAgIGlmIChvZmZQb3M+PTAgJiYgKHBvcyA+IG9mZlBvcykpIDo6XG4gICAgICAgICAgICB0aHJvdyBvZmZzaWRlQnJlYWtvdXRcblxuICAgICAgICAgIHRoaXMuX3BvcyA9IHBvc1xuXG5cbmxldCB0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzID0gbmV3IFNldCBAXG4gIEBbXSB0dC5faWYsIHR0Ll93aGlsZSwgdHQuX2ZvclxuICAgICwgdHQuX2NhdGNoLCB0dC5fc3dpdGNoXG5cbmxldCB0dF9vZmZzaWRlX2tleXdvcmRfbG9va2FoZWFkX3NraXAgPSBuZXcgU2V0IEBcbiAgQFtdIHR0LnBhcmVuTCwgdHQuY29sb24sIHR0LmNvbW1hLCB0dC5kb3RcblxubGV0IGF0X29mZnNpZGUgPVxuICBAe30gJzo6JzogICB7dG9rZW5QcmU6IHR0LmJyYWNlTCwgdG9rZW5Qb3N0OiB0dC5icmFjZVIsIG5lc3RJbm5lcjogZmFsc2UsIGNvZGVCbG9jazogdHJ1ZX1cbiAgICAsICc6OkAnOiAge3Rva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IGZhbHNlLCBleHRyYUNoYXJzOiAxfVxuICAgICwgJzo6KCknOiB7dG9rZW5QcmU6IHR0LnBhcmVuTCwgdG9rZW5Qb3N0OiB0dC5wYXJlblIsIG5lc3RJbm5lcjogZmFsc2UsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnOjp7fSc6IHt0b2tlblByZTogdHQuYnJhY2VMLCB0b2tlblBvc3Q6IHR0LmJyYWNlUiwgbmVzdElubmVyOiBmYWxzZSwgZXh0cmFDaGFyczogMn1cbiAgICAsICc6OltdJzoge3Rva2VuUHJlOiB0dC5icmFja2V0TCwgdG9rZW5Qb3N0OiB0dC5icmFja2V0UiwgbmVzdElubmVyOiBmYWxzZSwgZXh0cmFDaGFyczogMn1cbiAgICAsICdAJzogICAge3Rva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IHRydWUsIGtleXdvcmRCbG9jazogdHJ1ZX1cbiAgICAsICdAOic6ICAge3Rva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0T3A6ICc6Ont9JywgbmVzdElubmVyOiBmYWxzZSwga2V5d29yZEJsb2NrOiB0cnVlfVxuICAgICwgJ0AoKSc6ICB7dG9rZW5QcmU6IHR0LmJyYWNlTCwgdG9rZW5Qb3N0OiB0dC5icmFjZVIsIG5lc3RJbm5lcjogdHJ1ZSwgZXh0cmFDaGFyczogMn1cbiAgICAsICdAe30nOiAge3Rva2VuUHJlOiB0dC5icmFjZUwsIHRva2VuUG9zdDogdHQuYnJhY2VSLCBuZXN0SW5uZXI6IHRydWUsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnQFtdJzogIHt0b2tlblByZTogdHQuYnJhY2tldEwsIHRva2VuUG9zdDogdHQuYnJhY2tldFIsIG5lc3RJbm5lcjogdHJ1ZSwgZXh0cmFDaGFyczogMn1cbiAgICAvLyBub3RlOiAgbm8gJ0AoKScgLS0gc3RhbmRhcmRpemUgdG8gdXNlIHNpbmdsZS1jaGFyICdAICcgaW5zdGVhZFxuICAgICwga2V5d29yZF9hcmdzOiB7dG9rZW5QcmU6IHR0LnBhcmVuTCwgdG9rZW5Qb3N0OiB0dC5wYXJlblIsIG5lc3RJbm5lcjogZmFsc2UsIGluS2V5d29yZEFyZzogdHJ1ZX1cblxuXG5wcC5pc0ZvckF3YWl0ID0gZnVuY3Rpb24gKGtleXdvcmRUeXBlLCB0eXBlLCB2YWwpIDo6XG4gIHJldHVybiB0dC5fZm9yID09PSBrZXl3b3JkVHlwZVxuICAgICYmIHR0Lm5hbWUgPT09IHR5cGVcbiAgICAmJiAnYXdhaXQnID09PSB2YWxcblxucHAuX2Jhc2VfZmluaXNoVG9rZW4gPSBiYXNlUHJvdG8uZmluaXNoVG9rZW5cbnBwLmZpbmlzaFRva2VuID0gZnVuY3Rpb24odHlwZSwgdmFsKSA6OlxuICBjb25zdCBzdGF0ZSA9IHRoaXMuc3RhdGVcbiAgY29uc3QgcmVjZW50S2V5d29yZCA9IHN0YXRlLm9mZnNpZGVSZWNlbnRLZXl3b3JkXG4gIGxldCBpbkZvckF3YWl0ID0gcmVjZW50S2V5d29yZCA/IHRoaXMuaXNGb3JBd2FpdChyZWNlbnRLZXl3b3JkLCB0eXBlLCB2YWwpIDogbnVsbFxuICBzdGF0ZS5vZmZzaWRlUmVjZW50S2V5d29yZCA9IG51bGxcblxuICBpZiB0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzLmhhcyh0eXBlKSB8fCBpbkZvckF3YWl0IDo6XG4gICAgbGV0IGlzS2V5d29yZEFsbG93ZWQgPSAhdGhpcy5pc0xvb2thaGVhZFxuICAgICAgJiYgdHQuZG90ICE9PSBzdGF0ZS50eXBlXG5cbiAgICBpZiAhaXNLZXl3b3JkQWxsb3dlZCA6OlxuICAgICAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4odHlwZSwgdmFsKVxuXG4gICAgc3RhdGUub2Zmc2lkZVJlY2VudEtleXdvcmQgPSBpbkZvckF3YWl0ID8gdHQuX2ZvciA6IHR5cGVcbiAgICBjb25zdCBsb29rYWhlYWQgPSB0aGlzLmxvb2thaGVhZCgpXG5cbiAgICBpZiB0dF9vZmZzaWRlX2tleXdvcmRfbG9va2FoZWFkX3NraXAuaGFzKGxvb2thaGVhZC50eXBlKSA6OlxuICAgIGVsc2UgaWYgdGhpcy5pc0ZvckF3YWl0KHR5cGUsIGxvb2thaGVhZC50eXBlLCBsb29rYWhlYWQudmFsdWUpIDo6XG4gICAgZWxzZSA6OlxuICAgICAgc3RhdGUub2Zmc2lkZU5leHRPcCA9IGF0X29mZnNpZGUua2V5d29yZF9hcmdzXG5cbiAgICByZXR1cm4gdGhpcy5fYmFzZV9maW5pc2hUb2tlbih0eXBlLCB2YWwpXG5cbiAgaWYgdHlwZSA9PT0gdHQuYXQgfHwgdHlwZSA9PT0gdHQuZG91YmxlQ29sb24gOjpcbiAgICBjb25zdCBwb3MwID0gc3RhdGUuc3RhcnQsIHBvczEgPSBzdGF0ZS5wb3MgKyAyXG4gICAgY29uc3Qgc3RyX29wID0gdGhpcy5pbnB1dC5zbGljZShwb3MwLCBwb3MxKS5zcGxpdCgvXFxzLywgMSlbMF1cblxuICAgIGxldCBvcCA9IGF0X29mZnNpZGVbc3RyX29wXVxuICAgIGlmIG9wLmtleXdvcmRCbG9jayAmJiByZWNlbnRLZXl3b3JkICYmIHR0X29mZnNpZGVfa2V5d29yZF93aXRoX2FyZ3MuaGFzKHJlY2VudEtleXdvcmQpIDo6XG4gICAgICBvcCA9IGF0X29mZnNpZGUua2V5d29yZF9hcmdzXG5cbiAgICBpZiBvcC5uZXN0T3AgOjpcbiAgICAgIHN0YXRlLm9mZnNpZGVOZXh0T3AgPSBhdF9vZmZzaWRlW29wLm5lc3RPcF1cbiAgICBpZiBvcCA6OiByZXR1cm4gdGhpcy5maW5pc2hPZmZzaWRlT3Aob3ApXG5cbiAgaWYgdHQuZW9mID09PSB0eXBlIDo6XG4gICAgaWYgc3RhdGUub2Zmc2lkZS5sZW5ndGggOjpcbiAgICAgIHJldHVybiB0aGlzLnBvcE9mZnNpZGUoKVxuXG4gIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR5cGUsIHZhbClcblxuXG5wcC5vZmZzaWRlSW5kZW50ID0gZnVuY3Rpb24gKGxpbmUwLCBvdXRlckluZGVudCwgaW5uZXJJbmRlbnQpIDo6XG4gIGNvbnN0IG9mZnNpZGVfbGluZXMgPSB0aGlzLm9mZnNpZGVfbGluZXNcblxuICBpZiAobnVsbCA9PSBpbm5lckluZGVudCkgOjpcbiAgICBjb25zdCBpbm5lckxpbmUgPSBvZmZzaWRlX2xpbmVzW2xpbmUwKzFdXG4gICAgaW5uZXJJbmRlbnQgPSBpbm5lckxpbmUgPyBpbm5lckxpbmUuaW5kZW50IDogJydcblxuICBsZXQgbGluZT1saW5lMCsxLCBsYXN0PW9mZnNpZGVfbGluZXNbbGluZTBdXG4gIHdoaWxlIChsaW5lIDwgb2Zmc2lkZV9saW5lcy5sZW5ndGgpIDo6XG4gICAgY29uc3QgY3VyID0gb2Zmc2lkZV9saW5lc1tsaW5lXVxuICAgIGlmIChjdXIuY29udGVudCAmJiBvdXRlckluZGVudCA+PSBjdXIuaW5kZW50KSA6OlxuICAgICAgbGluZS0tIC8vIGJhY2t1cCB0byBwcmV2aW91cyBsaW5lXG4gICAgICBicmVha1xuXG4gICAgbGluZSsrOyBsYXN0ID0gY3VyXG4gICAgaWYgKGlubmVySW5kZW50ID4gY3VyLmluZGVudCkgOjpcbiAgICAgIGlubmVySW5kZW50ID0gY3VyLmluZGVudFxuXG4gIHJldHVybiBAe30gbGluZSwgbGFzdCwgaW5uZXJJbmRlbnRcblxuXG5wcC5vZmZzaWRlQmxvY2sgPSBmdW5jdGlvbiAob3AsIHN0YWNrVG9wLCByZWNlbnRLZXl3b3JkVG9wKSA6OlxuICBsZXQgb2Zmc2lkZV9saW5lcyA9IHRoaXMub2Zmc2lkZV9saW5lc1xuXG4gIGNvbnN0IGxpbmUwID0gdGhpcy5zdGF0ZS5jdXJMaW5lXG4gIGNvbnN0IGZpcnN0ID0gb2Zmc2lkZV9saW5lc1tsaW5lMF1cblxuICBsZXQgaW5kZW50LCBrZXl3b3JkTmVzdGVkSW5kZW50XG4gIGlmIChyZWNlbnRLZXl3b3JkVG9wKSA6OlxuICAgIGluZGVudCA9IHJlY2VudEtleXdvcmRUb3AuZmlyc3QuaW5kZW50XG4gIGVsc2UgaWYgKG9wLm5lc3RJbm5lciAmJiBzdGFja1RvcCAmJiBsaW5lMCA9PT0gc3RhY2tUb3AuZmlyc3QubGluZSkgOjpcbiAgICBpbmRlbnQgPSBzdGFja1RvcC5pbm5lckluZGVudFxuICBlbHNlIGlmIChvcC5pbktleXdvcmRBcmcpIDo6XG4gICAgaW5kZW50ID0gZmlyc3QuaW5kZW50XG4gICAgY29uc3QgaW5kZW50X2Jsb2NrID0gdGhpcy5vZmZzaWRlSW5kZW50KGxpbmUwLCBpbmRlbnQpXG4gICAgY29uc3QgaW5kZW50X2tleXdvcmQgPSB0aGlzLm9mZnNpZGVJbmRlbnQobGluZTAsIGluZGVudF9ibG9jay5pbm5lckluZGVudClcbiAgICBpZiAoaW5kZW50X2tleXdvcmQuaW5uZXJJbmRlbnQgPiBpbmRlbnRfYmxvY2suaW5uZXJJbmRlbnQpIDo6XG4gICAgICAvLyBhdXRvZGV0ZWN0IGtleXdvcmQgYXJndW1lbnQgdXNpbmcgJ0AnIGZvciBmdW5jdGlvbiBjYWxsc1xuICAgICAgaW5kZW50ID0gaW5kZW50X2Jsb2NrLmlubmVySW5kZW50XG4gICAgICBrZXl3b3JkTmVzdGVkSW5kZW50ID0gaW5kZW50X2tleXdvcmQuaW5uZXJJbmRlbnRcbiAgZWxzZSA6OlxuICAgIGluZGVudCA9IGZpcnN0LmluZGVudFxuXG4gIGxldCB7bGFzdCwgaW5uZXJJbmRlbnR9ID0gdGhpcy5vZmZzaWRlSW5kZW50KGxpbmUwLCBpbmRlbnQsIGtleXdvcmROZXN0ZWRJbmRlbnQpXG5cbiAgLy8gY2FwIHRvIFxuICBpbm5lckluZGVudCA9IGZpcnN0LmluZGVudCA+IGlubmVySW5kZW50XG4gICAgPyBmaXJzdC5pbmRlbnQgOiBpbm5lckluZGVudFxuXG4gIGlmIHN0YWNrVG9wICYmIHN0YWNrVG9wLmxhc3QucG9zTGFzdENvbnRlbnQgPCBsYXN0LnBvc0xhc3RDb250ZW50OjpcbiAgICAvLyBGaXh1cCBlbmNsb3Npbmcgc2NvcGVzLiBIYXBwZW5zIGluIHNpdHVhdGlvbnMgbGlrZTogYHNlcnZlci5vbiBAIHdyYXBlciBAICguLi5hcmdzKSA9PiA6OmBcbiAgICBjb25zdCBzdGFjayA9IHRoaXMuc3RhdGUub2Zmc2lkZVxuICAgIGZvciBsZXQgaWR4ID0gc3RhY2subGVuZ3RoLTE7IGlkeD4wOyBpZHgtLSA6OlxuICAgICAgbGV0IHRpcCA9IHN0YWNrW2lkeF1cbiAgICAgIGlmIHRpcC5sYXN0LnBvc0xhc3RDb250ZW50ID49IGxhc3QucG9zTGFzdENvbnRlbnQgOjogYnJlYWtcbiAgICAgIHRpcC5sYXN0ID0gbGFzdFxuXG4gIHJldHVybiB7b3AsIGlubmVySW5kZW50LCBmaXJzdCwgbGFzdH1cblxuXG5cbnBwLmZpbmlzaE9mZnNpZGVPcCA9IGZ1bmN0aW9uIChvcCkgOjpcbiAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YXRlLm9mZnNpZGVcbiAgbGV0IHN0YWNrVG9wID0gc3RhY2tbc3RhY2subGVuZ3RoIC0gMV1cbiAgbGV0IHJlY2VudEtleXdvcmRUb3BcbiAgaWYgKG9wLmNvZGVCbG9jaykgOjpcbiAgICBpZiAoc3RhY2tUb3AgJiYgc3RhY2tUb3AuaW5LZXl3b3JkQXJnKSA6OlxuICAgICAgdGhpcy5wb3BPZmZzaWRlKClcbiAgICAgIHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCA9IG9wXG4gICAgICB0aGlzLnN0YXRlLm9mZnNpZGVSZWNlbnRUb3AgPSBzdGFja1RvcFxuICAgICAgcmV0dXJuXG5cbiAgICByZWNlbnRLZXl3b3JkVG9wID0gdGhpcy5zdGF0ZS5vZmZzaWRlUmVjZW50VG9wXG4gICAgdGhpcy5zdGF0ZS5vZmZzaWRlUmVjZW50VG9wID0gbnVsbFxuXG4gIGlmIChvcC5leHRyYUNoYXJzKSA6OlxuICAgIHRoaXMuc3RhdGUucG9zICs9IG9wLmV4dHJhQ2hhcnNcblxuICB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKG9wLnRva2VuUHJlKVxuXG4gIGlmICh0aGlzLmlzTG9va2FoZWFkKSA6OiByZXR1cm5cblxuICBzdGFja1RvcCA9IHN0YWNrW3N0YWNrLmxlbmd0aCAtIDFdXG4gIGxldCBibGsgPSB0aGlzLm9mZnNpZGVCbG9jayhvcCwgc3RhY2tUb3AsIHJlY2VudEtleXdvcmRUb3ApXG4gIGJsay5pbktleXdvcmRBcmcgPSBvcC5pbktleXdvcmRBcmcgfHwgc3RhY2tUb3AgJiYgc3RhY2tUb3AuaW5LZXl3b3JkQXJnXG4gIHRoaXMuc3RhdGUub2Zmc2lkZS5wdXNoKGJsaylcblxuXG5wcC5fYmFzZV9za2lwU3BhY2UgPSBiYXNlUHJvdG8uc2tpcFNwYWNlXG5wcC5za2lwU3BhY2UgPSBmdW5jdGlvbigpIDo6XG4gIGlmIChudWxsICE9PSB0aGlzLnN0YXRlLm9mZnNpZGVOZXh0T3ApIDo6IHJldHVyblxuXG4gIGNvbnN0IHN0YWNrID0gdGhpcy5zdGF0ZS5vZmZzaWRlXG4gIGxldCBzdGFja1RvcFxuICBpZiAoc3RhY2sgJiYgc3RhY2subGVuZ3RoKSA6OlxuICAgIHN0YWNrVG9wID0gc3RhY2tbc3RhY2subGVuZ3RoLTFdXG4gICAgdGhpcy5zdGF0ZS5vZmZzaWRlUG9zID0gc3RhY2tUb3AubGFzdC5wb3NMYXN0Q29udGVudFxuICBlbHNlIDo6IHRoaXMuc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG5cbiAgdHJ5IDo6XG4gICAgdGhpcy5fYmFzZV9za2lwU3BhY2UoKVxuICAgIHRoaXMuc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG4gIGNhdGNoIChlcnIpIDo6XG4gICAgaWYgKGVyciAhPT0gb2Zmc2lkZUJyZWFrb3V0KSA6OiB0aHJvdyBlcnJcblxuXG5wcC5fYmFzZV9yZWFkVG9rZW4gPSBiYXNlUHJvdG8ucmVhZFRva2VuXG5wcC5yZWFkVG9rZW4gPSBmdW5jdGlvbihjb2RlKSA6OlxuICBjb25zdCBvZmZzaWRlTmV4dE9wID0gdGhpcy5zdGF0ZS5vZmZzaWRlTmV4dE9wXG4gIGlmIChudWxsICE9PSBvZmZzaWRlTmV4dE9wKSA6OlxuICAgIHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCA9IG51bGxcbiAgICByZXR1cm4gdGhpcy5maW5pc2hPZmZzaWRlT3Aob2Zmc2lkZU5leHRPcClcblxuICBlbHNlIGlmICh0aGlzLnN0YXRlLnBvcyA9PT0gdGhpcy5zdGF0ZS5vZmZzaWRlUG9zKSA6OlxuICAgIHJldHVybiB0aGlzLnBvcE9mZnNpZGUoKVxuXG4gIGVsc2UgOjpcbiAgICByZXR1cm4gdGhpcy5fYmFzZV9yZWFkVG9rZW4oY29kZSlcblxucHAucG9wT2Zmc2lkZSA9IGZ1bmN0aW9uKCkgOjpcbiAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YXRlLm9mZnNpZGVcbiAgbGV0IHN0YWNrVG9wID0gdGhpcy5pc0xvb2thaGVhZFxuICAgID8gc3RhY2tbc3RhY2subGVuZ3RoLTFdXG4gICAgOiBzdGFjay5wb3AoKVxuICB0aGlzLnN0YXRlLm9mZnNpZGVQb3MgPSAtMVxuXG4gIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4oc3RhY2tUb3Aub3AudG9rZW5Qb3N0KVxuICByZXR1cm4gc3RhY2tUb3BcblxuXG5cbmNvbnN0IHJ4X29mZnNpZGUgPSAvXihbIFxcdF0qKSguKikkL21nXG5mdW5jdGlvbiBwYXJzZU9mZnNpZGVJbmRleE1hcChpbnB1dCkgOjpcbiAgbGV0IGxpbmVzID0gW251bGxdLCBwb3NMYXN0Q29udGVudD0wLCBsYXN0PVsnJywgMF1cbiAgbGV0IGlkeF9sYXN0Q29udGVudD0wXG5cbiAgbGV0IGFucyA9IGlucHV0LnJlcGxhY2UgQCByeF9vZmZzaWRlLCAobWF0Y2gsIGluZGVudCwgY29udGVudCwgcG9zKSA9PiA6OlxuICAgIGlmICghY29udGVudCkgOjpcbiAgICAgIFtpbmRlbnQsIHBvc0xhc3RDb250ZW50XSA9IGxhc3QgLy8gYmxhbmsgbGluZTsgdXNlIGxhc3QgdmFsaWQgY29udGVudCBhcyBlbmRcbiAgICBlbHNlIDo6XG4gICAgICAvLyB2YWxpZCBjb250ZW50OyBzZXQgbGFzdCB0byBjdXJyZW50IGluZGVudFxuICAgICAgcG9zTGFzdENvbnRlbnQgPSBwb3MgKyBtYXRjaC5sZW5ndGhcbiAgICAgIGlkeF9sYXN0Q29udGVudCA9IGxpbmVzLmxlbmd0aFxuICAgICAgbGFzdCA9IFtpbmRlbnQsIHBvc0xhc3RDb250ZW50XVxuICAgIGxpbmVzLnB1c2goe2xpbmU6IGxpbmVzLmxlbmd0aCwgcG9zTGFzdENvbnRlbnQsIGluZGVudCwgY29udGVudH0pXG4gICAgcmV0dXJuICcnXG5cbiAgbGluZXMuc3BsaWNlKDEraWR4X2xhc3RDb250ZW50KSAvLyB0cmltIHRyYWlsaW5nIHdoaXRlc3BhY2VcbiAgcmV0dXJuIGxpbmVzXG5cblxuY29uc3QgYmFiZWxfcGx1Z2luX2lkID0gYGJhYmVsLXBsdWdpbi1vZmZzaWRlLS0ke0RhdGUubm93KCl9YFxuXG5jb25zdCBpc05vZGVNb2R1bGVEZXBlbmRlbmN5ID0gYUZpbGVQYXRoID0+XG4gIC9cXC9ub2RlX21vZHVsZXNcXC98XFxcXG5vZGVfbW9kdWxlc1xcXFwvLnRlc3QgQCBhRmlsZVBhdGhcbm1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IChiYWJlbCkgPT4gOjpcbiAgcmV0dXJuIDo6XG4gICAgbmFtZTogYmFiZWxfcGx1Z2luX2lkXG4gICAgLCBwcmUoc3RhdGUpIDo6XG4gICAgICAgIHRoaXMub3B0cyA9IE9iamVjdC5hc3NpZ24gQCB7fSwgZGVmYXVsdF9vZmZzaWRlUGx1Z2luT3B0cywgdGhpcy5vcHRzXG5cbiAgICAgICAgbGV0IGNoZWNrX2Jsb2NrcyA9IHRoaXMub3B0cy5jaGVja19ibG9ja3NcbiAgICAgICAgaWYgY2hlY2tfYmxvY2tzIGluc3RhbmNlb2YgRnVuY3Rpb24gOjpcbiAgICAgICAgICBjaGVja19ibG9ja3MgPSBjaGVja19ibG9ja3MgQCBzdGF0ZS5vcHRzLmZpbGVuYW1lXG4gICAgICAgIGVsc2UgaWYgY2hlY2tfYmxvY2tzIGluc3RhbmNlb2YgUmVnRXhwIDo6XG4gICAgICAgICAgY2hlY2tfYmxvY2tzID0gISBjaGVja19ibG9ja3MudGVzdCBAIHN0YXRlLm9wdHMuZmlsZW5hbWVcbiAgICAgICAgZWxzZSBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGNoZWNrX2Jsb2NrcyA6OlxuICAgICAgICAgIGNoZWNrX2Jsb2NrcyA9ICEgbmV3IFJlZ0V4cChjaGVja19ibG9ja3MpLnRlc3QgQCBzdGF0ZS5vcHRzLmZpbGVuYW1lXG5cbiAgICAgICAgdGhpcy5vcHRzLmNoZWNrX2Jsb2NrcyA9IGNoZWNrX2Jsb2NrcyA9ICEhIGNoZWNrX2Jsb2Nrc1xuXG4gICAgLy8sIHBvc3Qoc3RhdGUpIDo6IGNvbnNvbGUuZGlyIEAgc3RhdGUuYXN0LnByb2dyYW0sIEB7fSBjb2xvcnM6IHRydWUsIGRlcHRoOiBudWxsXG5cbiAgICAsIG1hbmlwdWxhdGVPcHRpb25zKG9wdHMsIHBhcnNlck9wdHMpIDo6XG4gICAgICAgIHBhcnNlck9wdHMucGx1Z2lucy5wdXNoKCdhc3luY0dlbmVyYXRvcnMnLCAnY2xhc3NQcm9wZXJ0aWVzJywgJ2RlY29yYXRvcnMnLCAnZnVuY3Rpb25CaW5kJylcbiAgICAgICAgY29uc3Qgb2Zmc2lkZVBsdWdpbk9wdHMgPSBvcHRzLnBsdWdpbnNcbiAgICAgICAgICAuZmlsdGVyIEAgcGx1Z2luID0+IHBsdWdpblswXSAmJiBiYWJlbF9wbHVnaW5faWQgPT09IHBsdWdpblswXS5rZXkgJiYgcGx1Z2luWzFdXG4gICAgICAgICAgLm1hcCBAIHBsdWdpbiA9PiBwbHVnaW5bMV1cbiAgICAgICAgICAucG9wKClcbiAgICAgICAgcGFyc2VyT3B0cy5vZmZzaWRlUGx1Z2luT3B0cyA9IG9mZnNpZGVQbHVnaW5PcHRzIHx8IGRlZmF1bHRfb2Zmc2lkZVBsdWdpbk9wdHNcblxuICAgICwgdmlzaXRvcjogOjpcbiAgICAgICAgUHJvZ3JhbShwYXRoKSA6OlxuICAgICAgICAgIGlmIHRoaXMub3B0cy5jaGVja19ibG9ja3MgOjogZW5zdXJlQ29uc2lzdGVudEJsb2NrSW5kZW50KHBhdGgsIHBhdGgubm9kZS5ib2R5KVxuXG4gICAgICAsIEJsb2NrU3RhdGVtZW50KHBhdGgpIDo6XG4gICAgICAgICAgaWYgdGhpcy5vcHRzLmNoZWNrX2Jsb2NrcyA6OiBlbnN1cmVDb25zaXN0ZW50QmxvY2tJbmRlbnQocGF0aCwgcGF0aC5ub2RlLmJvZHkpXG5cbiAgICAgICwgU3dpdGNoU3RhdGVtZW50KHBhdGgpIDo6XG4gICAgICAgICAgaWYgdGhpcy5vcHRzLmNoZWNrX2Jsb2NrcyA6OiBlbnN1cmVDb25zaXN0ZW50QmxvY2tJbmRlbnQocGF0aCwgcGF0aC5ub2RlLmNhc2VzKVxuXG4gICAgICAsIFN3aXRjaENhc2UocGF0aCkgOjpcbiAgICAgICAgICBpZiB0aGlzLm9wdHMuY2hlY2tfYmxvY2tzIDo6IGVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudChwYXRoLCBwYXRoLm5vZGUuY29uc2VxdWVudClcblxuZnVuY3Rpb24gZW5zdXJlQ29uc2lzdGVudEJsb2NrSW5kZW50KHBhdGgsIGJvZHkpIDo6XG4gIGlmIG51bGwgPT0gYm9keSA6OiBib2R5ID0gcGF0aC5ub2RlLmJvZHlcbiAgYm9keSA9IEFycmF5LmZyb20oYm9keSlcbiAgaWYgIWJvZHkgfHwgIWJvZHkubGVuZ3RoIDo6IHJldHVyblxuXG4gIGxldCBwcmV2X2xpbmUsIGJsb2NrX2NvbHVtbj1udWxsXG4gIGZvciBjb25zdCBjaGlsZCBvZiBib2R5IDo6XG4gICAgY29uc3QgbG9jID0gY2hpbGQubG9jXG4gICAgaWYgIWxvYyA6OlxuICAgICAgLy8gQSBzeW50aGV0aWMgY2hpbGQgb2Z0ZW4gZG9lcyBub3QgaGF2ZSBhIGxvY2F0aW9uLlxuICAgICAgLy8gRnVydGhlcm1vcmUsIGEgc3ludGhldGljIGNoaWxkIGluZGljYXRlcyB0aGF0IHNvbWV0aGluZyBpcyBtdWNraW5nXG4gICAgICAvLyBhcm91bmQgd2l0aCB0aGUgQVNULiBBZGFwdCBieSByZXNldHRpbmcgYmxvY2tfY29sdW1uIGFuZCBlbmZvcmNpbmdcbiAgICAgIC8vIG9ubHkgYWNyb3NzIGNvbnNlY3V0aXZlIGVudHJpZXMgd2l0aCB2YWxpZCBsb2NhdGlvbnMuXG4gICAgICBibG9ja19jb2x1bW4gPSBudWxsXG4gICAgICBjb250aW51ZVxuICAgIGVsc2UgaWYgbnVsbCA9PT0gYmxvY2tfY29sdW1uIDo6XG4gICAgICAvLyBhc3N1bWUgdGhlIGZpcnN0IGxvY2F0aW9uIGlzIGluZGVudGVkIHByb3Blcmx54oCmXG4gICAgICBibG9ja19jb2x1bW4gPSBsb2Muc3RhcnQuY29sdW1uXG5cbiAgICBpZiBsb2Muc3RhcnQubGluZSAhPSBwcmV2X2xpbmUgJiYgbG9jLnN0YXJ0LmNvbHVtbiAhPSBibG9ja19jb2x1bW4gOjpcbiAgICAgIHRocm93IHBhdGguaHViLmZpbGUuYnVpbGRDb2RlRnJhbWVFcnJvciBAIGNoaWxkLFxuICAgICAgICBgSW5kZW50IG1pc21hdGNoLiAoYmxvY2s6ICR7YmxvY2tfY29sdW1ufSwgc3RhdGVtZW50OiAke2xvYy5zdGFydC5jb2x1bW59KS4gXFxuYCArXG4gICAgICAgIGAgICAgKEZyb20gJ2NoZWNrX2Jsb2NrcycgZW5mb3JjZW1lbnQgb3B0aW9uIG9mIGJhYmVsLXBsdWdpbi1vZmZzaWRlKWBcblxuICAgIHByZXZfbGluZSA9IGxvYy5lbmQubGluZVxuXG5cbk9iamVjdC5hc3NpZ24gQCBleHBvcnRzLFxuICBAe31cbiAgICBob29rQmFieWxvbixcbiAgICBwYXJzZU9mZnNpZGVJbmRleE1hcCxcbiAgICBlbnN1cmVDb25zaXN0ZW50QmxvY2tJbmRlbnQsXG4iXX0=