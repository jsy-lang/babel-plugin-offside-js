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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL2NvZGUvaW5kZXguanMiXSwibmFtZXMiOlsiYmFieWxvbiIsInJlcXVpcmUiLCJ0dCIsInRva1R5cGVzIiwiX2dfb2Zmc2lkZVBsdWdpbk9wdHMiLCJkZWZhdWx0X29mZnNpZGVQbHVnaW5PcHRzIiwiY2hlY2tfYmxvY2tzIiwiX2Jhc2VfbW9kdWxlX3BhcnNlIiwicGFyc2UiLCJpbnB1dCIsIm9wdGlvbnMiLCJvZmZzaWRlUGx1Z2luT3B0cyIsInVuZGVmaW5lZCIsIlBhcnNlciIsImhvb2tCYWJ5bG9uIiwiYmFzZVByb3RvIiwicHJvdG90eXBlIiwicHAiLCJPYmplY3QiLCJjcmVhdGUiLCJ0Z3RfcGF0Y2giLCJicmFjZUwiLCJmbl91cGRhdGVDb250ZXh0IiwidXBkYXRlQ29udGV4dCIsInByZXZUeXBlIiwiY29uc3RydWN0b3IiLCJFcnJvciIsIl9iYXNlX3BhcnNlIiwiaW5pdE9mZnNpZGUiLCJPZmZzaWRlQnJlYWtvdXQiLCJvZmZzaWRlQnJlYWtvdXQiLCJzdGF0ZSIsIm9mZnNpZGUiLCJvZmZzaWRlTmV4dE9wIiwib2Zmc2lkZV9saW5lcyIsInBhcnNlT2Zmc2lkZUluZGV4TWFwIiwiX3BvcyIsInBvcyIsImRlZmluZVByb3BlcnR5IiwiZW51bWVyYWJsZSIsImdldCIsInNldCIsIm9mZlBvcyIsIm9mZnNpZGVQb3MiLCJ0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzIiwiU2V0IiwiX2lmIiwiX3doaWxlIiwiX2ZvciIsIl9jYXRjaCIsIl9zd2l0Y2giLCJ0dF9vZmZzaWRlX2tleXdvcmRfbG9va2FoZWFkX3NraXAiLCJwYXJlbkwiLCJjb2xvbiIsImNvbW1hIiwiZG90IiwiYXRfb2Zmc2lkZSIsInRva2VuUHJlIiwidG9rZW5Qb3N0IiwiYnJhY2VSIiwibmVzdElubmVyIiwiY29kZUJsb2NrIiwicGFyZW5SIiwiZXh0cmFDaGFycyIsImJyYWNrZXRMIiwiYnJhY2tldFIiLCJrZXl3b3JkQmxvY2siLCJrZXl3b3JkX2FyZ3MiLCJpbktleXdvcmRBcmciLCJpc0ZvckF3YWl0Iiwia2V5d29yZFR5cGUiLCJ0eXBlIiwidmFsIiwibmFtZSIsIl9iYXNlX2ZpbmlzaFRva2VuIiwiZmluaXNoVG9rZW4iLCJyZWNlbnRLZXl3b3JkIiwib2Zmc2lkZVJlY2VudEtleXdvcmQiLCJpbkZvckF3YWl0IiwiaGFzIiwiaXNLZXl3b3JkQWxsb3dlZCIsImlzTG9va2FoZWFkIiwibG9va2FoZWFkIiwidmFsdWUiLCJhdCIsImRvdWJsZUNvbG9uIiwicG9zMCIsInN0YXJ0IiwicG9zMSIsInN0cl9vcCIsInNsaWNlIiwic3BsaXQiLCJvcCIsImZpbmlzaE9mZnNpZGVPcCIsImVvZiIsImxlbmd0aCIsInBvcE9mZnNpZGUiLCJvZmZzaWRlSW5kZW50IiwibGluZTAiLCJvdXRlckluZGVudCIsImlubmVySW5kZW50IiwiaW5uZXJMaW5lIiwiaW5kZW50IiwibGluZSIsImxhc3QiLCJjdXIiLCJjb250ZW50Iiwib2Zmc2lkZUJsb2NrIiwic3RhY2tUb3AiLCJyZWNlbnRLZXl3b3JkVG9wIiwiY3VyTGluZSIsImZpcnN0Iiwia2V5d29yZE5lc3RlZEluZGVudCIsImluZGVudF9ibG9jayIsImluZGVudF9rZXl3b3JkIiwicG9zTGFzdENvbnRlbnQiLCJzdGFjayIsImlkeCIsInRpcCIsIm9mZnNpZGVSZWNlbnRUb3AiLCJibGsiLCJwdXNoIiwiX2Jhc2Vfc2tpcFNwYWNlIiwic2tpcFNwYWNlIiwiZXJyIiwiX2Jhc2VfcmVhZFRva2VuIiwicmVhZFRva2VuIiwiY29kZSIsInBvcCIsInJ4X29mZnNpZGUiLCJsaW5lcyIsImlkeF9sYXN0Q29udGVudCIsImFucyIsInJlcGxhY2UiLCJtYXRjaCIsInNwbGljZSIsImJhYmVsX3BsdWdpbl9pZCIsIkRhdGUiLCJub3ciLCJpc05vZGVNb2R1bGVEZXBlbmRlbmN5IiwiYUZpbGVQYXRoIiwidGVzdCIsIm1vZHVsZSIsImV4cG9ydHMiLCJiYWJlbCIsInByZSIsIm9wdHMiLCJhc3NpZ24iLCJGdW5jdGlvbiIsImZpbGVuYW1lIiwiUmVnRXhwIiwibWFuaXB1bGF0ZU9wdGlvbnMiLCJwYXJzZXJPcHRzIiwicGx1Z2lucyIsImZpbHRlciIsInBsdWdpbiIsImtleSIsIm1hcCIsInZpc2l0b3IiLCJQcm9ncmFtIiwicGF0aCIsImVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudCIsIm5vZGUiLCJib2R5IiwiQmxvY2tTdGF0ZW1lbnQiLCJTd2l0Y2hTdGF0ZW1lbnQiLCJjYXNlcyIsIlN3aXRjaENhc2UiLCJjb25zZXF1ZW50IiwiQXJyYXkiLCJmcm9tIiwicHJldl9saW5lIiwiYmxvY2tfY29sdW1uIiwiY2hpbGQiLCJsb2MiLCJjb2x1bW4iLCJodWIiLCJmaWxlIiwiYnVpbGRDb2RlRnJhbWVFcnJvciIsImVuZCJdLCJtYXBwaW5ncyI6IkFBQUEsTUFBTUEsVUFBVUMsUUFBUSxTQUFSLENBQWhCO0FBQ0EsTUFBTUMsS0FBS0YsUUFBUUcsUUFBbkI7O0FBRUEsSUFBSUMsb0JBQUo7QUFDQSxNQUFNQyw0QkFDSixFQUFJQyxjQUFjLG1DQUFsQixFQURGOztBQUdBLE1BQU1DLHFCQUFxQlAsUUFBUVEsS0FBbkM7QUFDQVIsUUFBUVEsS0FBUixHQUFnQixDQUFDQyxLQUFELEVBQVFDLE9BQVIsS0FBb0I7QUFDbENOLHlCQUF1Qk0sVUFBVUEsUUFBUUMsaUJBQWxCLEdBQXNDQyxTQUE3RDtBQUNBLFNBQU9MLG1CQUFtQkUsS0FBbkIsRUFBMEJDLE9BQTFCLENBQVA7QUFBeUMsQ0FGM0M7O0FBSUEsTUFBTUcsU0FBU0MsYUFBZjtBQUNBLE1BQU1DLFlBQVlGLE9BQU9HLFNBQXpCO0FBQ0EsTUFBTUMsS0FBS0osT0FBT0csU0FBUCxHQUFtQkUsT0FBT0MsTUFBUCxDQUFjSixTQUFkLENBQTlCOztBQUVBLFNBQVNELFdBQVQsR0FBdUI7QUFDckI7QUFDQTs7QUFFQSxNQUFJRCxNQUFKO0FBQ0EsTUFBSU8sWUFBWXBCLFFBQVFHLFFBQVIsQ0FBaUJrQixNQUFqQztBQUNBLE1BQUlDLG1CQUFtQkYsVUFBVUcsYUFBakM7QUFDQUgs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QUosRUFBVTtBQUNSO0FBQ0E7QUFDQTtBQUNBO0FBQ0FGLHFCQUFlLElBQWY7QUFDQTtBQUFRLEtBTlYsTUFPSyxJQUFHLFNBQVNBLFlBQVosRUFBMkI7QUFDOUI7QUFDQUEscUJBQWVFLElBQUl2RixLQUFKLENBQVV3RixNQUF6QjtBQUErQjs7QUFFakMsUUFBR0QsSUFBSXZGLEtBQUosQ0FBVWdCLElBQVYsSUFBa0JvRSxTQUFsQixJQUErQkcsSUFBSXZGLEtBQUosQ0FBVXdGLE1BQVYsSUFBb0JILFlBQXRELEVBQXFFO0FBQ25FLFlBQU1aLEtBQUtnQixHQUFMLENBQVNDLElBQVQsQ0FBY0MsbUJBQWQsQ0FBb0NMLEtBQXBDLEVBQ0gsNEJBQTJCRCxZQUFhLGdCQUFlRSxJQUFJdkYsS0FBSixDQUFVd0YsTUFBTyxPQUF6RSxHQUNDLHNFQUZHLENBQU47QUFFd0U7O0FBRTFFSixnQkFBWUcsSUFBSUssR0FBSixDQUFRNUUsSUFBcEI7QUFBd0I7QUFBQTs7QUFHNUJyRixPQUFPaUksTUFBUCxDQUFnQkosT0FBaEIsRUFDRTtBQUNFakksYUFERjtBQUVFcUIsc0JBRkY7QUFHRThILDZCQUhGLEVBREYiLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzQ29udGVudCI6WyJjb25zdCBiYWJ5bG9uID0gcmVxdWlyZSgnYmFieWxvbicpXG5jb25zdCB0dCA9IGJhYnlsb24udG9rVHlwZXNcblxudmFyIF9nX29mZnNpZGVQbHVnaW5PcHRzXG5jb25zdCBkZWZhdWx0X29mZnNpZGVQbHVnaW5PcHRzID1cbiAgQHt9IGNoZWNrX2Jsb2NrczogL1xcL25vZGVfbW9kdWxlc1xcL3xcXFxcbm9kZV9tb2R1bGVzXFxcXC9cblxuY29uc3QgX2Jhc2VfbW9kdWxlX3BhcnNlID0gYmFieWxvbi5wYXJzZVxuYmFieWxvbi5wYXJzZSA9IChpbnB1dCwgb3B0aW9ucykgPT4gOjpcbiAgX2dfb2Zmc2lkZVBsdWdpbk9wdHMgPSBvcHRpb25zID8gb3B0aW9ucy5vZmZzaWRlUGx1Z2luT3B0cyA6IHVuZGVmaW5lZFxuICByZXR1cm4gX2Jhc2VfbW9kdWxlX3BhcnNlKGlucHV0LCBvcHRpb25zKVxuXG5jb25zdCBQYXJzZXIgPSBob29rQmFieWxvbigpXG5jb25zdCBiYXNlUHJvdG8gPSBQYXJzZXIucHJvdG90eXBlXG5jb25zdCBwcCA9IFBhcnNlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKGJhc2VQcm90bylcblxuZnVuY3Rpb24gaG9va0JhYnlsb24oKSA6OlxuICAvLyBhYnVzZSBCYWJ5bG9uIHRva2VuIHVwZGF0ZUNvbnRleHQgY2FsbGJhY2sgZXh0cmFjdFxuICAvLyB0aGUgcmVmZXJlbmNlIHRvIFBhcnNlclxuXG4gIGxldCBQYXJzZXJcbiAgbGV0IHRndF9wYXRjaCA9IGJhYnlsb24udG9rVHlwZXMuYnJhY2VMXG4gIGxldCBmbl91cGRhdGVDb250ZXh0ID0gdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHRcbiAgdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHQgPSBmdW5jdGlvbiAocHJldlR5cGUpIDo6XG4gICAgdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHQgPSBmbl91cGRhdGVDb250ZXh0XG4gICAgUGFyc2VyID0gdGhpcy5jb25zdHJ1Y3RvclxuXG4gIGJhYnlsb24ucGFyc2UoJ3t9JylcbiAgaWYgKCFQYXJzZXIpIDo6XG4gICAgdGhyb3cgbmV3IEVycm9yIEAgXCJGYWlsZWQgdG8gaG9vayBCYWJ5bG9uIFBhcnNlclwiXG4gIHJldHVybiBQYXJzZXJcblxuXG5cbnBwLl9iYXNlX3BhcnNlID0gYmFzZVByb3RvLnBhcnNlXG5wcC5wYXJzZSA9IGZ1bmN0aW9uKCkgOjpcbiAgdGhpcy5pbml0T2Zmc2lkZSgpXG4gIHJldHVybiB0aGlzLl9iYXNlX3BhcnNlKClcblxuXG5jbGFzcyBPZmZzaWRlQnJlYWtvdXQgZXh0ZW5kcyBFcnJvciB7fVxuY29uc3Qgb2Zmc2lkZUJyZWFrb3V0ID0gbmV3IE9mZnNpZGVCcmVha291dCgpXG5cbnBwLmluaXRPZmZzaWRlID0gZnVuY3Rpb24oKSA6OlxuICB0aGlzLnN0YXRlLm9mZnNpZGUgPSBbXVxuICB0aGlzLnN0YXRlLm9mZnNpZGVOZXh0T3AgPSBudWxsXG4gIHRoaXMub2Zmc2lkZV9saW5lcyA9IHBhcnNlT2Zmc2lkZUluZGV4TWFwKHRoaXMuaW5wdXQpXG4gIHRoaXMub2Zmc2lkZVBsdWdpbk9wdHMgPSBfZ19vZmZzaWRlUGx1Z2luT3B0cyB8fCB7fVxuICBfZ19vZmZzaWRlUGx1Z2luT3B0cyA9IG51bGxcblxuICB0aGlzLnN0YXRlLl9wb3MgPSB0aGlzLnN0YXRlLnBvc1xuICBPYmplY3QuZGVmaW5lUHJvcGVydHkgQCB0aGlzLnN0YXRlLCAncG9zJyxcbiAgICBAe30gZW51bWVyYWJsZTogdHJ1ZVxuICAgICAgLCBnZXQoKSA6OiByZXR1cm4gdGhpcy5fcG9zXG4gICAgICAsIHNldChwb3MpIDo6XG4gICAgICAgICAgLy8gaW50ZXJydXB0IHNraXBTcGFjZSBhbGdvcml0aG0gd2hlbiB3ZSBoaXQgb3VyIHBvc2l0aW9uICdicmVha3BvaW50J1xuICAgICAgICAgIGxldCBvZmZQb3MgPSB0aGlzLm9mZnNpZGVQb3NcbiAgICAgICAgICBpZiAob2ZmUG9zPj0wICYmIChwb3MgPiBvZmZQb3MpKSA6OlxuICAgICAgICAgICAgdGhyb3cgb2Zmc2lkZUJyZWFrb3V0XG5cbiAgICAgICAgICB0aGlzLl9wb3MgPSBwb3NcblxuXG5sZXQgdHRfb2Zmc2lkZV9rZXl3b3JkX3dpdGhfYXJncyA9IG5ldyBTZXQgQFxuICBAW10gdHQuX2lmLCB0dC5fd2hpbGUsIHR0Ll9mb3JcbiAgICAsIHR0Ll9jYXRjaCwgdHQuX3N3aXRjaFxuXG5sZXQgdHRfb2Zmc2lkZV9rZXl3b3JkX2xvb2thaGVhZF9za2lwID0gbmV3IFNldCBAXG4gIEBbXSB0dC5wYXJlbkwsIHR0LmNvbG9uLCB0dC5jb21tYSwgdHQuZG90XG5cbmxldCBhdF9vZmZzaWRlID1cbiAgQHt9ICc6Oic6ICAge3Rva2VuUHJlOiB0dC5icmFjZUwsIHRva2VuUG9zdDogdHQuYnJhY2VSLCBuZXN0SW5uZXI6IGZhbHNlLCBjb2RlQmxvY2s6IHRydWV9XG4gICAgLCAnOjpAJzogIHt0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiBmYWxzZSwgZXh0cmFDaGFyczogMX1cbiAgICAsICc6OigpJzoge3Rva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IGZhbHNlLCBleHRyYUNoYXJzOiAyfVxuICAgICwgJzo6e30nOiB7dG9rZW5QcmU6IHR0LmJyYWNlTCwgdG9rZW5Qb3N0OiB0dC5icmFjZVIsIG5lc3RJbm5lcjogZmFsc2UsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnOjpbXSc6IHt0b2tlblByZTogdHQuYnJhY2tldEwsIHRva2VuUG9zdDogdHQuYnJhY2tldFIsIG5lc3RJbm5lcjogZmFsc2UsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnQCc6ICAgIHt0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiB0cnVlLCBrZXl3b3JkQmxvY2s6IHRydWV9XG4gICAgLCAnQCgpJzogIHt0b2tlblByZTogdHQuYnJhY2VMLCB0b2tlblBvc3Q6IHR0LmJyYWNlUiwgbmVzdElubmVyOiB0cnVlLCBleHRyYUNoYXJzOiAyfVxuICAgICwgJ0B7fSc6ICB7dG9rZW5QcmU6IHR0LmJyYWNlTCwgdG9rZW5Qb3N0OiB0dC5icmFjZVIsIG5lc3RJbm5lcjogdHJ1ZSwgZXh0cmFDaGFyczogMn1cbiAgICAsICdAW10nOiAge3Rva2VuUHJlOiB0dC5icmFja2V0TCwgdG9rZW5Qb3N0OiB0dC5icmFja2V0UiwgbmVzdElubmVyOiB0cnVlLCBleHRyYUNoYXJzOiAyfVxuICAgIC8vIG5vdGU6ICBubyAnQCgpJyAtLSBzdGFuZGFyZGl6ZSB0byB1c2Ugc2luZ2xlLWNoYXIgJ0AgJyBpbnN0ZWFkXG4gICAgLCBrZXl3b3JkX2FyZ3M6IHt0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiBmYWxzZSwgaW5LZXl3b3JkQXJnOiB0cnVlfVxuXG5cbnBwLmlzRm9yQXdhaXQgPSBmdW5jdGlvbiAoa2V5d29yZFR5cGUsIHR5cGUsIHZhbCkgOjpcbiAgcmV0dXJuIHR0Ll9mb3IgPT09IGtleXdvcmRUeXBlXG4gICAgJiYgdHQubmFtZSA9PT0gdHlwZVxuICAgICYmICdhd2FpdCcgPT09IHZhbFxuXG5wcC5fYmFzZV9maW5pc2hUb2tlbiA9IGJhc2VQcm90by5maW5pc2hUb2tlblxucHAuZmluaXNoVG9rZW4gPSBmdW5jdGlvbih0eXBlLCB2YWwpIDo6XG4gIGNvbnN0IHN0YXRlID0gdGhpcy5zdGF0ZVxuICBjb25zdCByZWNlbnRLZXl3b3JkID0gc3RhdGUub2Zmc2lkZVJlY2VudEtleXdvcmRcbiAgbGV0IGluRm9yQXdhaXQgPSByZWNlbnRLZXl3b3JkID8gdGhpcy5pc0ZvckF3YWl0KHJlY2VudEtleXdvcmQsIHR5cGUsIHZhbCkgOiBudWxsXG4gIHN0YXRlLm9mZnNpZGVSZWNlbnRLZXl3b3JkID0gbnVsbFxuXG4gIGlmIHR0X29mZnNpZGVfa2V5d29yZF93aXRoX2FyZ3MuaGFzKHR5cGUpIHx8IGluRm9yQXdhaXQgOjpcbiAgICBsZXQgaXNLZXl3b3JkQWxsb3dlZCA9ICF0aGlzLmlzTG9va2FoZWFkXG4gICAgICAmJiB0dC5kb3QgIT09IHN0YXRlLnR5cGVcblxuICAgIGlmICFpc0tleXdvcmRBbGxvd2VkIDo6XG4gICAgICByZXR1cm4gdGhpcy5fYmFzZV9maW5pc2hUb2tlbih0eXBlLCB2YWwpXG5cbiAgICBzdGF0ZS5vZmZzaWRlUmVjZW50S2V5d29yZCA9IGluRm9yQXdhaXQgPyB0dC5fZm9yIDogdHlwZVxuICAgIGNvbnN0IGxvb2thaGVhZCA9IHRoaXMubG9va2FoZWFkKClcblxuICAgIGlmIHR0X29mZnNpZGVfa2V5d29yZF9sb29rYWhlYWRfc2tpcC5oYXMobG9va2FoZWFkLnR5cGUpIDo6XG4gICAgZWxzZSBpZiB0aGlzLmlzRm9yQXdhaXQodHlwZSwgbG9va2FoZWFkLnR5cGUsIGxvb2thaGVhZC52YWx1ZSkgOjpcbiAgICBlbHNlIDo6XG4gICAgICBzdGF0ZS5vZmZzaWRlTmV4dE9wID0gYXRfb2Zmc2lkZS5rZXl3b3JkX2FyZ3NcblxuICAgIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR5cGUsIHZhbClcblxuICBpZiB0eXBlID09PSB0dC5hdCB8fCB0eXBlID09PSB0dC5kb3VibGVDb2xvbiA6OlxuICAgIGNvbnN0IHBvczAgPSBzdGF0ZS5zdGFydCwgcG9zMSA9IHN0YXRlLnBvcyArIDJcbiAgICBjb25zdCBzdHJfb3AgPSB0aGlzLmlucHV0LnNsaWNlKHBvczAsIHBvczEpLnNwbGl0KC9cXHMvLCAxKVswXVxuXG4gICAgbGV0IG9wID0gYXRfb2Zmc2lkZVtzdHJfb3BdXG4gICAgaWYgb3Aua2V5d29yZEJsb2NrICYmIHJlY2VudEtleXdvcmQgJiYgdHRfb2Zmc2lkZV9rZXl3b3JkX3dpdGhfYXJncy5oYXMocmVjZW50S2V5d29yZCkgOjpcbiAgICAgIG9wID0gYXRfb2Zmc2lkZS5rZXl3b3JkX2FyZ3NcbiAgICBpZiBvcCA6OiByZXR1cm4gdGhpcy5maW5pc2hPZmZzaWRlT3Aob3ApXG5cbiAgaWYgdHQuZW9mID09PSB0eXBlIDo6XG4gICAgaWYgc3RhdGUub2Zmc2lkZS5sZW5ndGggOjpcbiAgICAgIHJldHVybiB0aGlzLnBvcE9mZnNpZGUoKVxuXG4gIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR5cGUsIHZhbClcblxuXG5wcC5vZmZzaWRlSW5kZW50ID0gZnVuY3Rpb24gKGxpbmUwLCBvdXRlckluZGVudCwgaW5uZXJJbmRlbnQpIDo6XG4gIGNvbnN0IG9mZnNpZGVfbGluZXMgPSB0aGlzLm9mZnNpZGVfbGluZXNcblxuICBpZiAobnVsbCA9PSBpbm5lckluZGVudCkgOjpcbiAgICBjb25zdCBpbm5lckxpbmUgPSBvZmZzaWRlX2xpbmVzW2xpbmUwKzFdXG4gICAgaW5uZXJJbmRlbnQgPSBpbm5lckxpbmUgPyBpbm5lckxpbmUuaW5kZW50IDogJydcblxuICBsZXQgbGluZT1saW5lMCsxLCBsYXN0PW9mZnNpZGVfbGluZXNbbGluZTBdXG4gIHdoaWxlIChsaW5lIDwgb2Zmc2lkZV9saW5lcy5sZW5ndGgpIDo6XG4gICAgY29uc3QgY3VyID0gb2Zmc2lkZV9saW5lc1tsaW5lXVxuICAgIGlmIChjdXIuY29udGVudCAmJiBvdXRlckluZGVudCA+PSBjdXIuaW5kZW50KSA6OlxuICAgICAgbGluZS0tIC8vIGJhY2t1cCB0byBwcmV2aW91cyBsaW5lXG4gICAgICBicmVha1xuXG4gICAgbGluZSsrOyBsYXN0ID0gY3VyXG4gICAgaWYgKGlubmVySW5kZW50ID4gY3VyLmluZGVudCkgOjpcbiAgICAgIGlubmVySW5kZW50ID0gY3VyLmluZGVudFxuXG4gIHJldHVybiBAe30gbGluZSwgbGFzdCwgaW5uZXJJbmRlbnRcblxuXG5wcC5vZmZzaWRlQmxvY2sgPSBmdW5jdGlvbiAob3AsIHN0YWNrVG9wLCByZWNlbnRLZXl3b3JkVG9wKSA6OlxuICBsZXQgb2Zmc2lkZV9saW5lcyA9IHRoaXMub2Zmc2lkZV9saW5lc1xuXG4gIGNvbnN0IGxpbmUwID0gdGhpcy5zdGF0ZS5jdXJMaW5lXG4gIGNvbnN0IGZpcnN0ID0gb2Zmc2lkZV9saW5lc1tsaW5lMF1cblxuICBsZXQgaW5kZW50LCBrZXl3b3JkTmVzdGVkSW5kZW50XG4gIGlmIChyZWNlbnRLZXl3b3JkVG9wKSA6OlxuICAgIGluZGVudCA9IHJlY2VudEtleXdvcmRUb3AuZmlyc3QuaW5kZW50XG4gIGVsc2UgaWYgKG9wLm5lc3RJbm5lciAmJiBzdGFja1RvcCAmJiBsaW5lMCA9PT0gc3RhY2tUb3AuZmlyc3QubGluZSkgOjpcbiAgICBpbmRlbnQgPSBzdGFja1RvcC5pbm5lckluZGVudFxuICBlbHNlIGlmIChvcC5pbktleXdvcmRBcmcpIDo6XG4gICAgaW5kZW50ID0gZmlyc3QuaW5kZW50XG4gICAgY29uc3QgaW5kZW50X2Jsb2NrID0gdGhpcy5vZmZzaWRlSW5kZW50KGxpbmUwLCBpbmRlbnQpXG4gICAgY29uc3QgaW5kZW50X2tleXdvcmQgPSB0aGlzLm9mZnNpZGVJbmRlbnQobGluZTAsIGluZGVudF9ibG9jay5pbm5lckluZGVudClcbiAgICBpZiAoaW5kZW50X2tleXdvcmQuaW5uZXJJbmRlbnQgPiBpbmRlbnRfYmxvY2suaW5uZXJJbmRlbnQpIDo6XG4gICAgICAvLyBhdXRvZGV0ZWN0IGtleXdvcmQgYXJndW1lbnQgdXNpbmcgJ0AnIGZvciBmdW5jdGlvbiBjYWxsc1xuICAgICAgaW5kZW50ID0gaW5kZW50X2Jsb2NrLmlubmVySW5kZW50XG4gICAgICBrZXl3b3JkTmVzdGVkSW5kZW50ID0gaW5kZW50X2tleXdvcmQuaW5uZXJJbmRlbnRcbiAgZWxzZSA6OlxuICAgIGluZGVudCA9IGZpcnN0LmluZGVudFxuXG4gIGxldCB7bGFzdCwgaW5uZXJJbmRlbnR9ID0gdGhpcy5vZmZzaWRlSW5kZW50KGxpbmUwLCBpbmRlbnQsIGtleXdvcmROZXN0ZWRJbmRlbnQpXG5cbiAgLy8gY2FwIHRvIFxuICBpbm5lckluZGVudCA9IGZpcnN0LmluZGVudCA+IGlubmVySW5kZW50XG4gICAgPyBmaXJzdC5pbmRlbnQgOiBpbm5lckluZGVudFxuXG4gIGlmIHN0YWNrVG9wICYmIHN0YWNrVG9wLmxhc3QucG9zTGFzdENvbnRlbnQgPCBsYXN0LnBvc0xhc3RDb250ZW50OjpcbiAgICAvLyBGaXh1cCBlbmNsb3Npbmcgc2NvcGVzLiBIYXBwZW5zIGluIHNpdHVhdGlvbnMgbGlrZTogYHNlcnZlci5vbiBAIHdyYXBlciBAICguLi5hcmdzKSA9PiA6OmBcbiAgICBjb25zdCBzdGFjayA9IHRoaXMuc3RhdGUub2Zmc2lkZVxuICAgIGZvciBsZXQgaWR4ID0gc3RhY2subGVuZ3RoLTE7IGlkeD4wOyBpZHgtLSA6OlxuICAgICAgbGV0IHRpcCA9IHN0YWNrW2lkeF1cbiAgICAgIGlmIHRpcC5sYXN0LnBvc0xhc3RDb250ZW50ID49IGxhc3QucG9zTGFzdENvbnRlbnQgOjogYnJlYWtcbiAgICAgIHRpcC5sYXN0ID0gbGFzdFxuXG4gIHJldHVybiB7b3AsIGlubmVySW5kZW50LCBmaXJzdCwgbGFzdH1cblxuXG5cbnBwLmZpbmlzaE9mZnNpZGVPcCA9IGZ1bmN0aW9uIChvcCkgOjpcbiAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YXRlLm9mZnNpZGVcbiAgbGV0IHN0YWNrVG9wID0gc3RhY2tbc3RhY2subGVuZ3RoIC0gMV1cbiAgbGV0IHJlY2VudEtleXdvcmRUb3BcbiAgaWYgKG9wLmNvZGVCbG9jaykgOjpcbiAgICBpZiAoc3RhY2tUb3AgJiYgc3RhY2tUb3AuaW5LZXl3b3JkQXJnKSA6OlxuICAgICAgdGhpcy5wb3BPZmZzaWRlKClcbiAgICAgIHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCA9IG9wXG4gICAgICB0aGlzLnN0YXRlLm9mZnNpZGVSZWNlbnRUb3AgPSBzdGFja1RvcFxuICAgICAgcmV0dXJuXG5cbiAgICByZWNlbnRLZXl3b3JkVG9wID0gdGhpcy5zdGF0ZS5vZmZzaWRlUmVjZW50VG9wXG4gICAgdGhpcy5zdGF0ZS5vZmZzaWRlUmVjZW50VG9wID0gbnVsbFxuXG4gIGlmIChvcC5leHRyYUNoYXJzKSA6OlxuICAgIHRoaXMuc3RhdGUucG9zICs9IG9wLmV4dHJhQ2hhcnNcblxuICB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKG9wLnRva2VuUHJlKVxuXG4gIGlmICh0aGlzLmlzTG9va2FoZWFkKSA6OiByZXR1cm5cblxuICBzdGFja1RvcCA9IHN0YWNrW3N0YWNrLmxlbmd0aCAtIDFdXG4gIGxldCBibGsgPSB0aGlzLm9mZnNpZGVCbG9jayhvcCwgc3RhY2tUb3AsIHJlY2VudEtleXdvcmRUb3ApXG4gIGJsay5pbktleXdvcmRBcmcgPSBvcC5pbktleXdvcmRBcmcgfHwgc3RhY2tUb3AgJiYgc3RhY2tUb3AuaW5LZXl3b3JkQXJnXG4gIHRoaXMuc3RhdGUub2Zmc2lkZS5wdXNoKGJsaylcblxuXG5wcC5fYmFzZV9za2lwU3BhY2UgPSBiYXNlUHJvdG8uc2tpcFNwYWNlXG5wcC5za2lwU3BhY2UgPSBmdW5jdGlvbigpIDo6XG4gIGlmIChudWxsICE9PSB0aGlzLnN0YXRlLm9mZnNpZGVOZXh0T3ApIDo6IHJldHVyblxuXG4gIGNvbnN0IHN0YWNrID0gdGhpcy5zdGF0ZS5vZmZzaWRlXG4gIGxldCBzdGFja1RvcFxuICBpZiAoc3RhY2sgJiYgc3RhY2subGVuZ3RoKSA6OlxuICAgIHN0YWNrVG9wID0gc3RhY2tbc3RhY2subGVuZ3RoLTFdXG4gICAgdGhpcy5zdGF0ZS5vZmZzaWRlUG9zID0gc3RhY2tUb3AubGFzdC5wb3NMYXN0Q29udGVudFxuICBlbHNlIDo6IHRoaXMuc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG5cbiAgdHJ5IDo6XG4gICAgdGhpcy5fYmFzZV9za2lwU3BhY2UoKVxuICAgIHRoaXMuc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG4gIGNhdGNoIChlcnIpIDo6XG4gICAgaWYgKGVyciAhPT0gb2Zmc2lkZUJyZWFrb3V0KSA6OiB0aHJvdyBlcnJcblxuXG5wcC5fYmFzZV9yZWFkVG9rZW4gPSBiYXNlUHJvdG8ucmVhZFRva2VuXG5wcC5yZWFkVG9rZW4gPSBmdW5jdGlvbihjb2RlKSA6OlxuICBjb25zdCBvZmZzaWRlTmV4dE9wID0gdGhpcy5zdGF0ZS5vZmZzaWRlTmV4dE9wXG4gIGlmIChudWxsICE9PSBvZmZzaWRlTmV4dE9wKSA6OlxuICAgIHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCA9IG51bGxcbiAgICByZXR1cm4gdGhpcy5maW5pc2hPZmZzaWRlT3Aob2Zmc2lkZU5leHRPcClcblxuICBlbHNlIGlmICh0aGlzLnN0YXRlLnBvcyA9PT0gdGhpcy5zdGF0ZS5vZmZzaWRlUG9zKSA6OlxuICAgIHJldHVybiB0aGlzLnBvcE9mZnNpZGUoKVxuXG4gIGVsc2UgOjpcbiAgICByZXR1cm4gdGhpcy5fYmFzZV9yZWFkVG9rZW4oY29kZSlcblxucHAucG9wT2Zmc2lkZSA9IGZ1bmN0aW9uKCkgOjpcbiAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YXRlLm9mZnNpZGVcbiAgbGV0IHN0YWNrVG9wID0gdGhpcy5pc0xvb2thaGVhZFxuICAgID8gc3RhY2tbc3RhY2subGVuZ3RoLTFdXG4gICAgOiBzdGFjay5wb3AoKVxuICB0aGlzLnN0YXRlLm9mZnNpZGVQb3MgPSAtMVxuXG4gIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4oc3RhY2tUb3Aub3AudG9rZW5Qb3N0KVxuICByZXR1cm4gc3RhY2tUb3BcblxuXG5cbmNvbnN0IHJ4X29mZnNpZGUgPSAvXihbIFxcdF0qKSguKikkL21nXG5mdW5jdGlvbiBwYXJzZU9mZnNpZGVJbmRleE1hcChpbnB1dCkgOjpcbiAgbGV0IGxpbmVzID0gW251bGxdLCBwb3NMYXN0Q29udGVudD0wLCBsYXN0PVsnJywgMF1cbiAgbGV0IGlkeF9sYXN0Q29udGVudD0wXG5cbiAgbGV0IGFucyA9IGlucHV0LnJlcGxhY2UgQCByeF9vZmZzaWRlLCAobWF0Y2gsIGluZGVudCwgY29udGVudCwgcG9zKSA9PiA6OlxuICAgIGlmICghY29udGVudCkgOjpcbiAgICAgIFtpbmRlbnQsIHBvc0xhc3RDb250ZW50XSA9IGxhc3QgLy8gYmxhbmsgbGluZTsgdXNlIGxhc3QgdmFsaWQgY29udGVudCBhcyBlbmRcbiAgICBlbHNlIDo6XG4gICAgICAvLyB2YWxpZCBjb250ZW50OyBzZXQgbGFzdCB0byBjdXJyZW50IGluZGVudFxuICAgICAgcG9zTGFzdENvbnRlbnQgPSBwb3MgKyBtYXRjaC5sZW5ndGhcbiAgICAgIGlkeF9sYXN0Q29udGVudCA9IGxpbmVzLmxlbmd0aFxuICAgICAgbGFzdCA9IFtpbmRlbnQsIHBvc0xhc3RDb250ZW50XVxuICAgIGxpbmVzLnB1c2goe2xpbmU6IGxpbmVzLmxlbmd0aCwgcG9zTGFzdENvbnRlbnQsIGluZGVudCwgY29udGVudH0pXG4gICAgcmV0dXJuICcnXG5cbiAgbGluZXMuc3BsaWNlKDEraWR4X2xhc3RDb250ZW50KSAvLyB0cmltIHRyYWlsaW5nIHdoaXRlc3BhY2VcbiAgcmV0dXJuIGxpbmVzXG5cblxuY29uc3QgYmFiZWxfcGx1Z2luX2lkID0gYGJhYmVsLXBsdWdpbi1vZmZzaWRlLS0ke0RhdGUubm93KCl9YFxuXG5jb25zdCBpc05vZGVNb2R1bGVEZXBlbmRlbmN5ID0gYUZpbGVQYXRoID0+XG4gIC9cXC9ub2RlX21vZHVsZXNcXC98XFxcXG5vZGVfbW9kdWxlc1xcXFwvLnRlc3QgQCBhRmlsZVBhdGhcbm1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IChiYWJlbCkgPT4gOjpcbiAgcmV0dXJuIDo6XG4gICAgbmFtZTogYmFiZWxfcGx1Z2luX2lkXG4gICAgLCBwcmUoc3RhdGUpIDo6XG4gICAgICAgIHRoaXMub3B0cyA9IE9iamVjdC5hc3NpZ24gQCB7fSwgZGVmYXVsdF9vZmZzaWRlUGx1Z2luT3B0cywgdGhpcy5vcHRzXG5cbiAgICAgICAgbGV0IGNoZWNrX2Jsb2NrcyA9IHRoaXMub3B0cy5jaGVja19ibG9ja3NcbiAgICAgICAgaWYgY2hlY2tfYmxvY2tzIGluc3RhbmNlb2YgRnVuY3Rpb24gOjpcbiAgICAgICAgICBjaGVja19ibG9ja3MgPSBjaGVja19ibG9ja3MgQCBzdGF0ZS5vcHRzLmZpbGVuYW1lXG4gICAgICAgIGVsc2UgaWYgY2hlY2tfYmxvY2tzIGluc3RhbmNlb2YgUmVnRXhwIDo6XG4gICAgICAgICAgY2hlY2tfYmxvY2tzID0gISBjaGVja19ibG9ja3MudGVzdCBAIHN0YXRlLm9wdHMuZmlsZW5hbWVcbiAgICAgICAgZWxzZSBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGNoZWNrX2Jsb2NrcyA6OlxuICAgICAgICAgIGNoZWNrX2Jsb2NrcyA9ICEgbmV3IFJlZ0V4cChjaGVja19ibG9ja3MpLnRlc3QgQCBzdGF0ZS5vcHRzLmZpbGVuYW1lXG5cbiAgICAgICAgdGhpcy5vcHRzLmNoZWNrX2Jsb2NrcyA9IGNoZWNrX2Jsb2NrcyA9ICEhIGNoZWNrX2Jsb2Nrc1xuXG4gICAgLy8sIHBvc3Qoc3RhdGUpIDo6IGNvbnNvbGUuZGlyIEAgc3RhdGUuYXN0LnByb2dyYW0sIEB7fSBjb2xvcnM6IHRydWUsIGRlcHRoOiBudWxsXG5cbiAgICAsIG1hbmlwdWxhdGVPcHRpb25zKG9wdHMsIHBhcnNlck9wdHMpIDo6XG4gICAgICAgIHBhcnNlck9wdHMucGx1Z2lucy5wdXNoKCdhc3luY0dlbmVyYXRvcnMnLCAnY2xhc3NQcm9wZXJ0aWVzJywgJ2RlY29yYXRvcnMnLCAnZnVuY3Rpb25CaW5kJylcbiAgICAgICAgY29uc3Qgb2Zmc2lkZVBsdWdpbk9wdHMgPSBvcHRzLnBsdWdpbnNcbiAgICAgICAgICAuZmlsdGVyIEAgcGx1Z2luID0+IHBsdWdpblswXSAmJiBiYWJlbF9wbHVnaW5faWQgPT09IHBsdWdpblswXS5rZXkgJiYgcGx1Z2luWzFdXG4gICAgICAgICAgLm1hcCBAIHBsdWdpbiA9PiBwbHVnaW5bMV1cbiAgICAgICAgICAucG9wKClcbiAgICAgICAgcGFyc2VyT3B0cy5vZmZzaWRlUGx1Z2luT3B0cyA9IG9mZnNpZGVQbHVnaW5PcHRzIHx8IGRlZmF1bHRfb2Zmc2lkZVBsdWdpbk9wdHNcblxuICAgICwgdmlzaXRvcjogOjpcbiAgICAgICAgUHJvZ3JhbShwYXRoKSA6OlxuICAgICAgICAgIGlmIHRoaXMub3B0cy5jaGVja19ibG9ja3MgOjogZW5zdXJlQ29uc2lzdGVudEJsb2NrSW5kZW50KHBhdGgsIHBhdGgubm9kZS5ib2R5KVxuXG4gICAgICAsIEJsb2NrU3RhdGVtZW50KHBhdGgpIDo6XG4gICAgICAgICAgaWYgdGhpcy5vcHRzLmNoZWNrX2Jsb2NrcyA6OiBlbnN1cmVDb25zaXN0ZW50QmxvY2tJbmRlbnQocGF0aCwgcGF0aC5ub2RlLmJvZHkpXG5cbiAgICAgICwgU3dpdGNoU3RhdGVtZW50KHBhdGgpIDo6XG4gICAgICAgICAgaWYgdGhpcy5vcHRzLmNoZWNrX2Jsb2NrcyA6OiBlbnN1cmVDb25zaXN0ZW50QmxvY2tJbmRlbnQocGF0aCwgcGF0aC5ub2RlLmNhc2VzKVxuXG4gICAgICAsIFN3aXRjaENhc2UocGF0aCkgOjpcbiAgICAgICAgICBpZiB0aGlzLm9wdHMuY2hlY2tfYmxvY2tzIDo6IGVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudChwYXRoLCBwYXRoLm5vZGUuY29uc2VxdWVudClcblxuZnVuY3Rpb24gZW5zdXJlQ29uc2lzdGVudEJsb2NrSW5kZW50KHBhdGgsIGJvZHkpIDo6XG4gIGlmIG51bGwgPT0gYm9keSA6OiBib2R5ID0gcGF0aC5ub2RlLmJvZHlcbiAgYm9keSA9IEFycmF5LmZyb20oYm9keSlcbiAgaWYgIWJvZHkgfHwgIWJvZHkubGVuZ3RoIDo6IHJldHVyblxuXG4gIGxldCBwcmV2X2xpbmUsIGJsb2NrX2NvbHVtbj1udWxsXG4gIGZvciBjb25zdCBjaGlsZCBvZiBib2R5IDo6XG4gICAgY29uc3QgbG9jID0gY2hpbGQubG9jXG4gICAgaWYgIWxvYyA6OlxuICAgICAgLy8gQSBzeW50aGV0aWMgY2hpbGQgb2Z0ZW4gZG9lcyBub3QgaGF2ZSBhIGxvY2F0aW9uLlxuICAgICAgLy8gRnVydGhlcm1vcmUsIGEgc3ludGhldGljIGNoaWxkIGluZGljYXRlcyB0aGF0IHNvbWV0aGluZyBpcyBtdWNraW5nXG4gICAgICAvLyBhcm91bmQgd2l0aCB0aGUgQVNULiBBZGFwdCBieSByZXNldHRpbmcgYmxvY2tfY29sdW1uIGFuZCBlbmZvcmNpbmdcbiAgICAgIC8vIG9ubHkgYWNyb3NzIGNvbnNlY3V0aXZlIGVudHJpZXMgd2l0aCB2YWxpZCBsb2NhdGlvbnMuXG4gICAgICBibG9ja19jb2x1bW4gPSBudWxsXG4gICAgICBjb250aW51ZVxuICAgIGVsc2UgaWYgbnVsbCA9PT0gYmxvY2tfY29sdW1uIDo6XG4gICAgICAvLyBhc3N1bWUgdGhlIGZpcnN0IGxvY2F0aW9uIGlzIGluZGVudGVkIHByb3Blcmx54oCmXG4gICAgICBibG9ja19jb2x1bW4gPSBsb2Muc3RhcnQuY29sdW1uXG5cbiAgICBpZiBsb2Muc3RhcnQubGluZSAhPSBwcmV2X2xpbmUgJiYgbG9jLnN0YXJ0LmNvbHVtbiAhPSBibG9ja19jb2x1bW4gOjpcbiAgICAgIHRocm93IHBhdGguaHViLmZpbGUuYnVpbGRDb2RlRnJhbWVFcnJvciBAIGNoaWxkLFxuICAgICAgICBgSW5kZW50IG1pc21hdGNoLiAoYmxvY2s6ICR7YmxvY2tfY29sdW1ufSwgc3RhdGVtZW50OiAke2xvYy5zdGFydC5jb2x1bW59KS4gXFxuYCArXG4gICAgICAgIGAgICAgKEZyb20gJ2NoZWNrX2Jsb2NrcycgZW5mb3JjZW1lbnQgb3B0aW9uIG9mIGJhYmVsLXBsdWdpbi1vZmZzaWRlKWBcblxuICAgIHByZXZfbGluZSA9IGxvYy5lbmQubGluZVxuXG5cbk9iamVjdC5hc3NpZ24gQCBleHBvcnRzLFxuICBAe31cbiAgICBob29rQmFieWxvbixcbiAgICBwYXJzZU9mZnNpZGVJbmRleE1hcCxcbiAgICBlbnN1cmVDb25zaXN0ZW50QmxvY2tJbmRlbnQsXG4iXX0=