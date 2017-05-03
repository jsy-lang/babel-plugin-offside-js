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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL2NvZGUvaW5kZXguanMiXSwibmFtZXMiOlsiYmFieWxvbiIsInJlcXVpcmUiLCJ0dCIsInRva1R5cGVzIiwiX2dfb2Zmc2lkZVBsdWdpbk9wdHMiLCJkZWZhdWx0X29mZnNpZGVQbHVnaW5PcHRzIiwiY2hlY2tfYmxvY2tzIiwiX2Jhc2VfbW9kdWxlX3BhcnNlIiwicGFyc2UiLCJpbnB1dCIsIm9wdGlvbnMiLCJvZmZzaWRlUGx1Z2luT3B0cyIsInVuZGVmaW5lZCIsIlBhcnNlciIsImhvb2tCYWJ5bG9uIiwiYmFzZVByb3RvIiwicHJvdG90eXBlIiwicHAiLCJPYmplY3QiLCJjcmVhdGUiLCJ0Z3RfcGF0Y2giLCJicmFjZUwiLCJmbl91cGRhdGVDb250ZXh0IiwidXBkYXRlQ29udGV4dCIsInByZXZUeXBlIiwiY29uc3RydWN0b3IiLCJFcnJvciIsIl9iYXNlX3BhcnNlIiwiaW5pdE9mZnNpZGUiLCJPZmZzaWRlQnJlYWtvdXQiLCJvZmZzaWRlQnJlYWtvdXQiLCJzdGF0ZSIsIm9mZnNpZGUiLCJvZmZzaWRlTmV4dE9wIiwib2Zmc2lkZV9saW5lcyIsInBhcnNlT2Zmc2lkZUluZGV4TWFwIiwiX3BvcyIsInBvcyIsImRlZmluZVByb3BlcnR5IiwiZW51bWVyYWJsZSIsImdldCIsInNldCIsIm9mZlBvcyIsIm9mZnNpZGVQb3MiLCJ0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzIiwiU2V0IiwiX2lmIiwiX3doaWxlIiwiX2ZvciIsIl9jYXRjaCIsIl9zd2l0Y2giLCJ0dF9vZmZzaWRlX2tleXdvcmRfbG9va2FoZWFkX3NraXAiLCJwYXJlbkwiLCJjb2xvbiIsImNvbW1hIiwiZG90IiwiYXRfb2Zmc2lkZSIsInRva2VuUHJlIiwidG9rZW5Qb3N0IiwiYnJhY2VSIiwibmVzdElubmVyIiwiY29kZUJsb2NrIiwicGFyZW5SIiwiZXh0cmFDaGFycyIsImJyYWNrZXRMIiwiYnJhY2tldFIiLCJrZXl3b3JkQmxvY2siLCJrZXl3b3JkX2FyZ3MiLCJpbktleXdvcmRBcmciLCJpc0ZvckF3YWl0Iiwia2V5d29yZFR5cGUiLCJ0eXBlIiwidmFsIiwibmFtZSIsIl9iYXNlX2ZpbmlzaFRva2VuIiwiZmluaXNoVG9rZW4iLCJyZWNlbnRLZXl3b3JkIiwib2Zmc2lkZVJlY2VudEtleXdvcmQiLCJpbkZvckF3YWl0IiwiaGFzIiwiaXNLZXl3b3JkQWxsb3dlZCIsImlzTG9va2FoZWFkIiwibG9va2FoZWFkIiwidmFsdWUiLCJhdCIsImRvdWJsZUNvbG9uIiwicG9zMCIsInN0YXJ0IiwicG9zMSIsInN0cl9vcCIsInNsaWNlIiwic3BsaXQiLCJvcCIsImZpbmlzaE9mZnNpZGVPcCIsImVvZiIsImxlbmd0aCIsInBvcE9mZnNpZGUiLCJvZmZzaWRlSW5kZW50IiwibGluZTAiLCJvdXRlckluZGVudCIsImlubmVySW5kZW50IiwiaW5uZXJMaW5lIiwiaW5kZW50IiwibGluZSIsImxhc3QiLCJjdXIiLCJjb250ZW50Iiwib2Zmc2lkZUJsb2NrIiwic3RhY2tUb3AiLCJyZWNlbnRLZXl3b3JkVG9wIiwiY3VyTGluZSIsImZpcnN0Iiwia2V5d29yZE5lc3RlZEluZGVudCIsImluZGVudF9ibG9jayIsImluZGVudF9rZXl3b3JkIiwic3RhY2siLCJvZmZzaWRlUmVjZW50VG9wIiwiYmxrIiwicHVzaCIsIl9iYXNlX3NraXBTcGFjZSIsInNraXBTcGFjZSIsInBvc0xhc3RDb250ZW50IiwiZXJyIiwiX2Jhc2VfcmVhZFRva2VuIiwicmVhZFRva2VuIiwiY29kZSIsInBvcCIsInJ4X29mZnNpZGUiLCJsaW5lcyIsImlkeF9sYXN0Q29udGVudCIsImFucyIsInJlcGxhY2UiLCJtYXRjaCIsInNwbGljZSIsImJhYmVsX3BsdWdpbl9pZCIsIkRhdGUiLCJub3ciLCJpc05vZGVNb2R1bGVEZXBlbmRlbmN5IiwiYUZpbGVQYXRoIiwidGVzdCIsIm1vZHVsZSIsImV4cG9ydHMiLCJiYWJlbCIsInByZSIsIm9wdHMiLCJhc3NpZ24iLCJGdW5jdGlvbiIsImZpbGVuYW1lIiwiUmVnRXhwIiwibWFuaXB1bGF0ZU9wdGlvbnMiLCJwYXJzZXJPcHRzIiwicGx1Z2lucyIsImZpbHRlciIsInBsdWdpbiIsImtleSIsIm1hcCIsInZpc2l0b3IiLCJQcm9ncmFtIiwicGF0aCIsImVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudCIsIm5vZGUiLCJib2R5IiwiQmxvY2tTdGF0ZW1lbnQiLCJTd2l0Y2hTdGF0ZW1lbnQiLCJjYXNlcyIsIlN3aXRjaENhc2UiLCJjb25zZXF1ZW50IiwiQXJyYXkiLCJmcm9tIiwicHJldl9saW5lIiwiYmxvY2tfY29sdW1uIiwiY2hpbGQiLCJsb2MiLCJjb2x1bW4iLCJodWIiLCJmaWxlIiwiYnVpbGRDb2RlRnJhbWVFcnJvciIsImVuZCJdLCJtYXBwaW5ncyI6IkFBQUEsTUFBTUEsVUFBVUMsUUFBUSxTQUFSLENBQWhCO0FBQ0EsTUFBTUMsS0FBS0YsUUFBUUcsUUFBbkI7O0FBRUEsSUFBSUMsb0JBQUo7QUFDQSxNQUFNQyw0QkFDSixFQUFJQyxjQUFjLG1DQUFsQixFQURGOztBQUdBLE1BQU1DLHFCQUFxQlAsUUFBUVEsS0FBbkM7QUFDQVIsUUFBUVEsS0FBUixHQUFnQixDQUFDQyxLQUFELEVBQVFDLE9BQVIsS0FBb0I7QUFDbENOLHlCQUF1Qk0sVUFBVUEsUUFBUUMsaUJBQWxCLEdBQXNDQyxTQUE3RDtBQUNBLFNBQU9MLG1CQUFtQkUsS0FBbkIsRUFBMEJDLE9BQTFCLENBQVA7QUFBeUMsQ0FGM0M7O0FBSUEsTUFBTUcsU0FBU0MsYUFBZjtBQUNBLE1BQU1DLFlBQVlGLE9BQU9HLFNBQXpCO0FBQ0EsTUFBTUMsS0FBS0osT0FBT0csU0FBUCxHQUFtQkUsT0FBT0MsTUFBUCxDQUFjSixTQUFkLENBQTlCOztBQUVBLFNBQVNELFdBQVQsR0FBdUI7QUFDckI7QUFDQTs7QUFFQSxNQUFJRCxNQUFKO0FBQ0EsTUFBSU8sWUFBWXBCLFFBQVFHLFFBQVIsQ0FBaUJrQixNQUFqQztBQUNBLE1BQUlDLG1CQUFtQkYsVUFBVUcsYUFBakM7QUFDQUgsWUFBVUcsYUFBVixHQUEw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LE9BQXpFLEdBQ0Msc0VBRkcsQ0FBTjtBQUV3RTs7QUFFMUVKLGdCQUFZRyxJQUFJSyxHQUFKLENBQVExRSxJQUFwQjtBQUF3QjtBQUFBOztBQUc1QnJGLE9BQU8rSCxNQUFQLENBQWdCSixPQUFoQixFQUNFO0FBQ0UvSCxhQURGO0FBRUVxQixzQkFGRjtBQUdFNEgsNkJBSEYsRUFERiIsImZpbGUiOiJpbmRleC5qcyIsInNvdXJjZXNDb250ZW50IjpbImNvbnN0IGJhYnlsb24gPSByZXF1aXJlKCdiYWJ5bG9uJylcbmNvbnN0IHR0ID0gYmFieWxvbi50b2tUeXBlc1xuXG52YXIgX2dfb2Zmc2lkZVBsdWdpbk9wdHNcbmNvbnN0IGRlZmF1bHRfb2Zmc2lkZVBsdWdpbk9wdHMgPVxuICBAe30gY2hlY2tfYmxvY2tzOiAvXFwvbm9kZV9tb2R1bGVzXFwvfFxcXFxub2RlX21vZHVsZXNcXFxcL1xuXG5jb25zdCBfYmFzZV9tb2R1bGVfcGFyc2UgPSBiYWJ5bG9uLnBhcnNlXG5iYWJ5bG9uLnBhcnNlID0gKGlucHV0LCBvcHRpb25zKSA9PiA6OlxuICBfZ19vZmZzaWRlUGx1Z2luT3B0cyA9IG9wdGlvbnMgPyBvcHRpb25zLm9mZnNpZGVQbHVnaW5PcHRzIDogdW5kZWZpbmVkXG4gIHJldHVybiBfYmFzZV9tb2R1bGVfcGFyc2UoaW5wdXQsIG9wdGlvbnMpXG5cbmNvbnN0IFBhcnNlciA9IGhvb2tCYWJ5bG9uKClcbmNvbnN0IGJhc2VQcm90byA9IFBhcnNlci5wcm90b3R5cGVcbmNvbnN0IHBwID0gUGFyc2VyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoYmFzZVByb3RvKVxuXG5mdW5jdGlvbiBob29rQmFieWxvbigpIDo6XG4gIC8vIGFidXNlIEJhYnlsb24gdG9rZW4gdXBkYXRlQ29udGV4dCBjYWxsYmFjayBleHRyYWN0XG4gIC8vIHRoZSByZWZlcmVuY2UgdG8gUGFyc2VyXG5cbiAgbGV0IFBhcnNlclxuICBsZXQgdGd0X3BhdGNoID0gYmFieWxvbi50b2tUeXBlcy5icmFjZUxcbiAgbGV0IGZuX3VwZGF0ZUNvbnRleHQgPSB0Z3RfcGF0Y2gudXBkYXRlQ29udGV4dFxuICB0Z3RfcGF0Y2gudXBkYXRlQ29udGV4dCA9IGZ1bmN0aW9uIChwcmV2VHlwZSkgOjpcbiAgICB0Z3RfcGF0Y2gudXBkYXRlQ29udGV4dCA9IGZuX3VwZGF0ZUNvbnRleHRcbiAgICBQYXJzZXIgPSB0aGlzLmNvbnN0cnVjdG9yXG5cbiAgYmFieWxvbi5wYXJzZSgne30nKVxuICBpZiAoIVBhcnNlcikgOjpcbiAgICB0aHJvdyBuZXcgRXJyb3IgQCBcIkZhaWxlZCB0byBob29rIEJhYnlsb24gUGFyc2VyXCJcbiAgcmV0dXJuIFBhcnNlclxuXG5cblxucHAuX2Jhc2VfcGFyc2UgPSBiYXNlUHJvdG8ucGFyc2VcbnBwLnBhcnNlID0gZnVuY3Rpb24oKSA6OlxuICB0aGlzLmluaXRPZmZzaWRlKClcbiAgcmV0dXJuIHRoaXMuX2Jhc2VfcGFyc2UoKVxuXG5cbmNsYXNzIE9mZnNpZGVCcmVha291dCBleHRlbmRzIEVycm9yIHt9XG5jb25zdCBvZmZzaWRlQnJlYWtvdXQgPSBuZXcgT2Zmc2lkZUJyZWFrb3V0KClcblxucHAuaW5pdE9mZnNpZGUgPSBmdW5jdGlvbigpIDo6XG4gIHRoaXMuc3RhdGUub2Zmc2lkZSA9IFtdXG4gIHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCA9IG51bGxcbiAgdGhpcy5vZmZzaWRlX2xpbmVzID0gcGFyc2VPZmZzaWRlSW5kZXhNYXAodGhpcy5pbnB1dClcbiAgdGhpcy5vZmZzaWRlUGx1Z2luT3B0cyA9IF9nX29mZnNpZGVQbHVnaW5PcHRzIHx8IHt9XG4gIF9nX29mZnNpZGVQbHVnaW5PcHRzID0gbnVsbFxuXG4gIHRoaXMuc3RhdGUuX3BvcyA9IHRoaXMuc3RhdGUucG9zXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIHRoaXMuc3RhdGUsICdwb3MnLFxuICAgIEB7fSBlbnVtZXJhYmxlOiB0cnVlXG4gICAgICAsIGdldCgpIDo6IHJldHVybiB0aGlzLl9wb3NcbiAgICAgICwgc2V0KHBvcykgOjpcbiAgICAgICAgICAvLyBpbnRlcnJ1cHQgc2tpcFNwYWNlIGFsZ29yaXRobSB3aGVuIHdlIGhpdCBvdXIgcG9zaXRpb24gJ2JyZWFrcG9pbnQnXG4gICAgICAgICAgbGV0IG9mZlBvcyA9IHRoaXMub2Zmc2lkZVBvc1xuICAgICAgICAgIGlmIChvZmZQb3M+PTAgJiYgKHBvcyA+IG9mZlBvcykpIDo6XG4gICAgICAgICAgICB0aHJvdyBvZmZzaWRlQnJlYWtvdXRcblxuICAgICAgICAgIHRoaXMuX3BvcyA9IHBvc1xuXG5cbmxldCB0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzID0gbmV3IFNldCBAXG4gIEBbXSB0dC5faWYsIHR0Ll93aGlsZSwgdHQuX2ZvclxuICAgICwgdHQuX2NhdGNoLCB0dC5fc3dpdGNoXG5cbmxldCB0dF9vZmZzaWRlX2tleXdvcmRfbG9va2FoZWFkX3NraXAgPSBuZXcgU2V0IEBcbiAgQFtdIHR0LnBhcmVuTCwgdHQuY29sb24sIHR0LmNvbW1hLCB0dC5kb3RcblxubGV0IGF0X29mZnNpZGUgPVxuICBAe30gJzo6JzogICB7dG9rZW5QcmU6IHR0LmJyYWNlTCwgdG9rZW5Qb3N0OiB0dC5icmFjZVIsIG5lc3RJbm5lcjogZmFsc2UsIGNvZGVCbG9jazogdHJ1ZX1cbiAgICAsICc6OkAnOiAge3Rva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IGZhbHNlLCBleHRyYUNoYXJzOiAxfVxuICAgICwgJzo6KCknOiB7dG9rZW5QcmU6IHR0LnBhcmVuTCwgdG9rZW5Qb3N0OiB0dC5wYXJlblIsIG5lc3RJbm5lcjogZmFsc2UsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnOjp7fSc6IHt0b2tlblByZTogdHQuYnJhY2VMLCB0b2tlblBvc3Q6IHR0LmJyYWNlUiwgbmVzdElubmVyOiBmYWxzZSwgZXh0cmFDaGFyczogMn1cbiAgICAsICc6OltdJzoge3Rva2VuUHJlOiB0dC5icmFja2V0TCwgdG9rZW5Qb3N0OiB0dC5icmFja2V0UiwgbmVzdElubmVyOiBmYWxzZSwgZXh0cmFDaGFyczogMn1cbiAgICAsICdAJzogICAge3Rva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IHRydWUsIGtleXdvcmRCbG9jazogdHJ1ZX1cbiAgICAsICdAKCknOiAge3Rva2VuUHJlOiB0dC5icmFjZUwsIHRva2VuUG9zdDogdHQuYnJhY2VSLCBuZXN0SW5uZXI6IHRydWUsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnQHt9JzogIHt0b2tlblByZTogdHQuYnJhY2VMLCB0b2tlblBvc3Q6IHR0LmJyYWNlUiwgbmVzdElubmVyOiB0cnVlLCBleHRyYUNoYXJzOiAyfVxuICAgICwgJ0BbXSc6ICB7dG9rZW5QcmU6IHR0LmJyYWNrZXRMLCB0b2tlblBvc3Q6IHR0LmJyYWNrZXRSLCBuZXN0SW5uZXI6IHRydWUsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLy8gbm90ZTogIG5vICdAKCknIC0tIHN0YW5kYXJkaXplIHRvIHVzZSBzaW5nbGUtY2hhciAnQCAnIGluc3RlYWRcbiAgICAsIGtleXdvcmRfYXJnczoge3Rva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IGZhbHNlLCBpbktleXdvcmRBcmc6IHRydWV9XG5cblxucHAuaXNGb3JBd2FpdCA9IGZ1bmN0aW9uIChrZXl3b3JkVHlwZSwgdHlwZSwgdmFsKSA6OlxuICByZXR1cm4gdHQuX2ZvciA9PT0ga2V5d29yZFR5cGVcbiAgICAmJiB0dC5uYW1lID09PSB0eXBlXG4gICAgJiYgJ2F3YWl0JyA9PT0gdmFsXG5cbnBwLl9iYXNlX2ZpbmlzaFRva2VuID0gYmFzZVByb3RvLmZpbmlzaFRva2VuXG5wcC5maW5pc2hUb2tlbiA9IGZ1bmN0aW9uKHR5cGUsIHZhbCkgOjpcbiAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0YXRlXG4gIGNvbnN0IHJlY2VudEtleXdvcmQgPSBzdGF0ZS5vZmZzaWRlUmVjZW50S2V5d29yZFxuICBsZXQgaW5Gb3JBd2FpdCA9IHJlY2VudEtleXdvcmQgPyB0aGlzLmlzRm9yQXdhaXQocmVjZW50S2V5d29yZCwgdHlwZSwgdmFsKSA6IG51bGxcbiAgc3RhdGUub2Zmc2lkZVJlY2VudEtleXdvcmQgPSBudWxsXG5cbiAgaWYgdHRfb2Zmc2lkZV9rZXl3b3JkX3dpdGhfYXJncy5oYXModHlwZSkgfHwgaW5Gb3JBd2FpdCA6OlxuICAgIGxldCBpc0tleXdvcmRBbGxvd2VkID0gIXRoaXMuaXNMb29rYWhlYWRcbiAgICAgICYmIHR0LmRvdCAhPT0gc3RhdGUudHlwZVxuXG4gICAgaWYgIWlzS2V5d29yZEFsbG93ZWQgOjpcbiAgICAgIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR5cGUsIHZhbClcblxuICAgIHN0YXRlLm9mZnNpZGVSZWNlbnRLZXl3b3JkID0gaW5Gb3JBd2FpdCA/IHR0Ll9mb3IgOiB0eXBlXG4gICAgY29uc3QgbG9va2FoZWFkID0gdGhpcy5sb29rYWhlYWQoKVxuXG4gICAgaWYgdHRfb2Zmc2lkZV9rZXl3b3JkX2xvb2thaGVhZF9za2lwLmhhcyhsb29rYWhlYWQudHlwZSkgOjpcbiAgICBlbHNlIGlmIHRoaXMuaXNGb3JBd2FpdCh0eXBlLCBsb29rYWhlYWQudHlwZSwgbG9va2FoZWFkLnZhbHVlKSA6OlxuICAgIGVsc2UgOjpcbiAgICAgIHN0YXRlLm9mZnNpZGVOZXh0T3AgPSBhdF9vZmZzaWRlLmtleXdvcmRfYXJnc1xuXG4gICAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4odHlwZSwgdmFsKVxuXG4gIGlmIHR5cGUgPT09IHR0LmF0IHx8IHR5cGUgPT09IHR0LmRvdWJsZUNvbG9uIDo6XG4gICAgY29uc3QgcG9zMCA9IHN0YXRlLnN0YXJ0LCBwb3MxID0gc3RhdGUucG9zICsgMlxuICAgIGNvbnN0IHN0cl9vcCA9IHRoaXMuaW5wdXQuc2xpY2UocG9zMCwgcG9zMSkuc3BsaXQoL1xccy8sIDEpWzBdXG5cbiAgICBsZXQgb3AgPSBhdF9vZmZzaWRlW3N0cl9vcF1cbiAgICBpZiBvcC5rZXl3b3JkQmxvY2sgJiYgcmVjZW50S2V5d29yZCAmJiB0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzLmhhcyhyZWNlbnRLZXl3b3JkKSA6OlxuICAgICAgb3AgPSBhdF9vZmZzaWRlLmtleXdvcmRfYXJnc1xuICAgIGlmIG9wIDo6IHJldHVybiB0aGlzLmZpbmlzaE9mZnNpZGVPcChvcClcblxuICBpZiB0dC5lb2YgPT09IHR5cGUgOjpcbiAgICBpZiBzdGF0ZS5vZmZzaWRlLmxlbmd0aCA6OlxuICAgICAgcmV0dXJuIHRoaXMucG9wT2Zmc2lkZSgpXG5cbiAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4odHlwZSwgdmFsKVxuXG5cbnBwLm9mZnNpZGVJbmRlbnQgPSBmdW5jdGlvbiAobGluZTAsIG91dGVySW5kZW50LCBpbm5lckluZGVudCkgOjpcbiAgY29uc3Qgb2Zmc2lkZV9saW5lcyA9IHRoaXMub2Zmc2lkZV9saW5lc1xuXG4gIGlmIChudWxsID09IGlubmVySW5kZW50KSA6OlxuICAgIGNvbnN0IGlubmVyTGluZSA9IG9mZnNpZGVfbGluZXNbbGluZTArMV1cbiAgICBpbm5lckluZGVudCA9IGlubmVyTGluZSA/IGlubmVyTGluZS5pbmRlbnQgOiAnJ1xuXG4gIGxldCBsaW5lPWxpbmUwKzEsIGxhc3Q9b2Zmc2lkZV9saW5lc1tsaW5lMF1cbiAgd2hpbGUgKGxpbmUgPCBvZmZzaWRlX2xpbmVzLmxlbmd0aCkgOjpcbiAgICBjb25zdCBjdXIgPSBvZmZzaWRlX2xpbmVzW2xpbmVdXG4gICAgaWYgKGN1ci5jb250ZW50ICYmIG91dGVySW5kZW50ID49IGN1ci5pbmRlbnQpIDo6XG4gICAgICBsaW5lLS0gLy8gYmFja3VwIHRvIHByZXZpb3VzIGxpbmVcbiAgICAgIGJyZWFrXG5cbiAgICBsaW5lKys7IGxhc3QgPSBjdXJcbiAgICBpZiAoaW5uZXJJbmRlbnQgPiBjdXIuaW5kZW50KSA6OlxuICAgICAgaW5uZXJJbmRlbnQgPSBjdXIuaW5kZW50XG5cbiAgcmV0dXJuIEB7fSBsaW5lLCBsYXN0LCBpbm5lckluZGVudFxuXG5cbnBwLm9mZnNpZGVCbG9jayA9IGZ1bmN0aW9uIChvcCwgc3RhY2tUb3AsIHJlY2VudEtleXdvcmRUb3ApIDo6XG4gIGxldCBvZmZzaWRlX2xpbmVzID0gdGhpcy5vZmZzaWRlX2xpbmVzXG5cbiAgY29uc3QgbGluZTAgPSB0aGlzLnN0YXRlLmN1ckxpbmVcbiAgY29uc3QgZmlyc3QgPSBvZmZzaWRlX2xpbmVzW2xpbmUwXVxuXG4gIGxldCBpbmRlbnQsIGtleXdvcmROZXN0ZWRJbmRlbnRcbiAgaWYgKHJlY2VudEtleXdvcmRUb3ApIDo6XG4gICAgaW5kZW50ID0gcmVjZW50S2V5d29yZFRvcC5maXJzdC5pbmRlbnRcbiAgZWxzZSBpZiAob3AubmVzdElubmVyICYmIHN0YWNrVG9wICYmIGxpbmUwID09PSBzdGFja1RvcC5maXJzdC5saW5lKSA6OlxuICAgIGluZGVudCA9IHN0YWNrVG9wLmlubmVySW5kZW50XG4gIGVsc2UgaWYgKG9wLmluS2V5d29yZEFyZykgOjpcbiAgICBpbmRlbnQgPSBmaXJzdC5pbmRlbnRcbiAgICBjb25zdCBpbmRlbnRfYmxvY2sgPSB0aGlzLm9mZnNpZGVJbmRlbnQobGluZTAsIGluZGVudClcbiAgICBjb25zdCBpbmRlbnRfa2V5d29yZCA9IHRoaXMub2Zmc2lkZUluZGVudChsaW5lMCwgaW5kZW50X2Jsb2NrLmlubmVySW5kZW50KVxuICAgIGlmIChpbmRlbnRfa2V5d29yZC5pbm5lckluZGVudCA+IGluZGVudF9ibG9jay5pbm5lckluZGVudCkgOjpcbiAgICAgIC8vIGF1dG9kZXRlY3Qga2V5d29yZCBhcmd1bWVudCB1c2luZyAnQCcgZm9yIGZ1bmN0aW9uIGNhbGxzXG4gICAgICBpbmRlbnQgPSBpbmRlbnRfYmxvY2suaW5uZXJJbmRlbnRcbiAgICAgIGtleXdvcmROZXN0ZWRJbmRlbnQgPSBpbmRlbnRfa2V5d29yZC5pbm5lckluZGVudFxuICBlbHNlIDo6XG4gICAgaW5kZW50ID0gZmlyc3QuaW5kZW50XG5cbiAgbGV0IHtsYXN0LCBpbm5lckluZGVudH0gPSB0aGlzLm9mZnNpZGVJbmRlbnQobGluZTAsIGluZGVudCwga2V5d29yZE5lc3RlZEluZGVudClcblxuICAvLyBjYXAgdG8gXG4gIGlubmVySW5kZW50ID0gZmlyc3QuaW5kZW50ID4gaW5uZXJJbmRlbnRcbiAgICA/IGZpcnN0LmluZGVudCA6IGlubmVySW5kZW50XG5cbiAgcmV0dXJuIHtvcCwgaW5uZXJJbmRlbnQsIGZpcnN0LCBsYXN0fVxuXG5cblxucHAuZmluaXNoT2Zmc2lkZU9wID0gZnVuY3Rpb24gKG9wKSA6OlxuICBjb25zdCBzdGFjayA9IHRoaXMuc3RhdGUub2Zmc2lkZVxuICBsZXQgc3RhY2tUb3AgPSBzdGFja1tzdGFjay5sZW5ndGggLSAxXVxuICBsZXQgcmVjZW50S2V5d29yZFRvcFxuICBpZiAob3AuY29kZUJsb2NrKSA6OlxuICAgIGlmIChzdGFja1RvcCAmJiBzdGFja1RvcC5pbktleXdvcmRBcmcpIDo6XG4gICAgICB0aGlzLnBvcE9mZnNpZGUoKVxuICAgICAgdGhpcy5zdGF0ZS5vZmZzaWRlTmV4dE9wID0gb3BcbiAgICAgIHRoaXMuc3RhdGUub2Zmc2lkZVJlY2VudFRvcCA9IHN0YWNrVG9wXG4gICAgICByZXR1cm5cblxuICAgIHJlY2VudEtleXdvcmRUb3AgPSB0aGlzLnN0YXRlLm9mZnNpZGVSZWNlbnRUb3BcbiAgICB0aGlzLnN0YXRlLm9mZnNpZGVSZWNlbnRUb3AgPSBudWxsXG5cbiAgaWYgKG9wLmV4dHJhQ2hhcnMpIDo6XG4gICAgdGhpcy5zdGF0ZS5wb3MgKz0gb3AuZXh0cmFDaGFyc1xuXG4gIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4ob3AudG9rZW5QcmUpXG5cbiAgaWYgKHRoaXMuaXNMb29rYWhlYWQpIDo6IHJldHVyblxuXG4gIHN0YWNrVG9wID0gc3RhY2tbc3RhY2subGVuZ3RoIC0gMV1cbiAgbGV0IGJsayA9IHRoaXMub2Zmc2lkZUJsb2NrKG9wLCBzdGFja1RvcCwgcmVjZW50S2V5d29yZFRvcClcbiAgYmxrLmluS2V5d29yZEFyZyA9IG9wLmluS2V5d29yZEFyZyB8fCBzdGFja1RvcCAmJiBzdGFja1RvcC5pbktleXdvcmRBcmdcbiAgdGhpcy5zdGF0ZS5vZmZzaWRlLnB1c2goYmxrKVxuXG5cbnBwLl9iYXNlX3NraXBTcGFjZSA9IGJhc2VQcm90by5za2lwU3BhY2VcbnBwLnNraXBTcGFjZSA9IGZ1bmN0aW9uKCkgOjpcbiAgaWYgKG51bGwgIT09IHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCkgOjogcmV0dXJuXG5cbiAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YXRlLm9mZnNpZGVcbiAgbGV0IHN0YWNrVG9wXG4gIGlmIChzdGFjayAmJiBzdGFjay5sZW5ndGgpIDo6XG4gICAgc3RhY2tUb3AgPSBzdGFja1tzdGFjay5sZW5ndGgtMV1cbiAgICB0aGlzLnN0YXRlLm9mZnNpZGVQb3MgPSBzdGFja1RvcC5sYXN0LnBvc0xhc3RDb250ZW50XG4gIGVsc2UgOjogdGhpcy5zdGF0ZS5vZmZzaWRlUG9zID0gLTFcblxuICB0cnkgOjpcbiAgICB0aGlzLl9iYXNlX3NraXBTcGFjZSgpXG4gICAgdGhpcy5zdGF0ZS5vZmZzaWRlUG9zID0gLTFcbiAgY2F0Y2ggKGVycikgOjpcbiAgICBpZiAoZXJyICE9PSBvZmZzaWRlQnJlYWtvdXQpIDo6IHRocm93IGVyclxuXG5cbnBwLl9iYXNlX3JlYWRUb2tlbiA9IGJhc2VQcm90by5yZWFkVG9rZW5cbnBwLnJlYWRUb2tlbiA9IGZ1bmN0aW9uKGNvZGUpIDo6XG4gIGNvbnN0IG9mZnNpZGVOZXh0T3AgPSB0aGlzLnN0YXRlLm9mZnNpZGVOZXh0T3BcbiAgaWYgKG51bGwgIT09IG9mZnNpZGVOZXh0T3ApIDo6XG4gICAgdGhpcy5zdGF0ZS5vZmZzaWRlTmV4dE9wID0gbnVsbFxuICAgIHJldHVybiB0aGlzLmZpbmlzaE9mZnNpZGVPcChvZmZzaWRlTmV4dE9wKVxuXG4gIGVsc2UgaWYgKHRoaXMuc3RhdGUucG9zID09PSB0aGlzLnN0YXRlLm9mZnNpZGVQb3MpIDo6XG4gICAgcmV0dXJuIHRoaXMucG9wT2Zmc2lkZSgpXG5cbiAgZWxzZSA6OlxuICAgIHJldHVybiB0aGlzLl9iYXNlX3JlYWRUb2tlbihjb2RlKVxuXG5wcC5wb3BPZmZzaWRlID0gZnVuY3Rpb24oKSA6OlxuICBjb25zdCBzdGFjayA9IHRoaXMuc3RhdGUub2Zmc2lkZVxuICBsZXQgc3RhY2tUb3AgPSB0aGlzLmlzTG9va2FoZWFkXG4gICAgPyBzdGFja1tzdGFjay5sZW5ndGgtMV1cbiAgICA6IHN0YWNrLnBvcCgpXG4gIHRoaXMuc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG5cbiAgdGhpcy5fYmFzZV9maW5pc2hUb2tlbihzdGFja1RvcC5vcC50b2tlblBvc3QpXG4gIHJldHVybiBzdGFja1RvcFxuXG5cblxuY29uc3Qgcnhfb2Zmc2lkZSA9IC9eKFsgXFx0XSopKC4qKSQvbWdcbmZ1bmN0aW9uIHBhcnNlT2Zmc2lkZUluZGV4TWFwKGlucHV0KSA6OlxuICBsZXQgbGluZXMgPSBbbnVsbF0sIHBvc0xhc3RDb250ZW50PTAsIGxhc3Q9WycnLCAwXVxuICBsZXQgaWR4X2xhc3RDb250ZW50PTBcblxuICBsZXQgYW5zID0gaW5wdXQucmVwbGFjZSBAIHJ4X29mZnNpZGUsIChtYXRjaCwgaW5kZW50LCBjb250ZW50LCBwb3MpID0+IDo6XG4gICAgaWYgKCFjb250ZW50KSA6OlxuICAgICAgW2luZGVudCwgcG9zTGFzdENvbnRlbnRdID0gbGFzdCAvLyBibGFuayBsaW5lOyB1c2UgbGFzdCB2YWxpZCBjb250ZW50IGFzIGVuZFxuICAgIGVsc2UgOjpcbiAgICAgIC8vIHZhbGlkIGNvbnRlbnQ7IHNldCBsYXN0IHRvIGN1cnJlbnQgaW5kZW50XG4gICAgICBwb3NMYXN0Q29udGVudCA9IHBvcyArIG1hdGNoLmxlbmd0aFxuICAgICAgaWR4X2xhc3RDb250ZW50ID0gbGluZXMubGVuZ3RoXG4gICAgICBsYXN0ID0gW2luZGVudCwgcG9zTGFzdENvbnRlbnRdXG4gICAgbGluZXMucHVzaCh7bGluZTogbGluZXMubGVuZ3RoLCBwb3NMYXN0Q29udGVudCwgaW5kZW50LCBjb250ZW50fSlcbiAgICByZXR1cm4gJydcblxuICBsaW5lcy5zcGxpY2UoMStpZHhfbGFzdENvbnRlbnQpIC8vIHRyaW0gdHJhaWxpbmcgd2hpdGVzcGFjZVxuICByZXR1cm4gbGluZXNcblxuXG5jb25zdCBiYWJlbF9wbHVnaW5faWQgPSBgYmFiZWwtcGx1Z2luLW9mZnNpZGUtLSR7RGF0ZS5ub3coKX1gXG5cbmNvbnN0IGlzTm9kZU1vZHVsZURlcGVuZGVuY3kgPSBhRmlsZVBhdGggPT5cbiAgL1xcL25vZGVfbW9kdWxlc1xcL3xcXFxcbm9kZV9tb2R1bGVzXFxcXC8udGVzdCBAIGFGaWxlUGF0aFxubW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzID0gKGJhYmVsKSA9PiA6OlxuICByZXR1cm4gOjpcbiAgICBuYW1lOiBiYWJlbF9wbHVnaW5faWRcbiAgICAsIHByZShzdGF0ZSkgOjpcbiAgICAgICAgdGhpcy5vcHRzID0gT2JqZWN0LmFzc2lnbiBAIHt9LCBkZWZhdWx0X29mZnNpZGVQbHVnaW5PcHRzLCB0aGlzLm9wdHNcblxuICAgICAgICBsZXQgY2hlY2tfYmxvY2tzID0gdGhpcy5vcHRzLmNoZWNrX2Jsb2Nrc1xuICAgICAgICBpZiBjaGVja19ibG9ja3MgaW5zdGFuY2VvZiBGdW5jdGlvbiA6OlxuICAgICAgICAgIGNoZWNrX2Jsb2NrcyA9IGNoZWNrX2Jsb2NrcyBAIHN0YXRlLm9wdHMuZmlsZW5hbWVcbiAgICAgICAgZWxzZSBpZiBjaGVja19ibG9ja3MgaW5zdGFuY2VvZiBSZWdFeHAgOjpcbiAgICAgICAgICBjaGVja19ibG9ja3MgPSAhIGNoZWNrX2Jsb2Nrcy50ZXN0IEAgc3RhdGUub3B0cy5maWxlbmFtZVxuICAgICAgICBlbHNlIGlmICdzdHJpbmcnID09PSB0eXBlb2YgY2hlY2tfYmxvY2tzIDo6XG4gICAgICAgICAgY2hlY2tfYmxvY2tzID0gISBuZXcgUmVnRXhwKGNoZWNrX2Jsb2NrcykudGVzdCBAIHN0YXRlLm9wdHMuZmlsZW5hbWVcblxuICAgICAgICB0aGlzLm9wdHMuY2hlY2tfYmxvY2tzID0gY2hlY2tfYmxvY2tzID0gISEgY2hlY2tfYmxvY2tzXG5cbiAgICAvLywgcG9zdChzdGF0ZSkgOjogY29uc29sZS5kaXIgQCBzdGF0ZS5hc3QucHJvZ3JhbSwgQHt9IGNvbG9yczogdHJ1ZSwgZGVwdGg6IG51bGxcblxuICAgICwgbWFuaXB1bGF0ZU9wdGlvbnMob3B0cywgcGFyc2VyT3B0cykgOjpcbiAgICAgICAgcGFyc2VyT3B0cy5wbHVnaW5zLnB1c2goJ2FzeW5jR2VuZXJhdG9ycycsICdjbGFzc1Byb3BlcnRpZXMnLCAnZGVjb3JhdG9ycycsICdmdW5jdGlvbkJpbmQnKVxuICAgICAgICBjb25zdCBvZmZzaWRlUGx1Z2luT3B0cyA9IG9wdHMucGx1Z2luc1xuICAgICAgICAgIC5maWx0ZXIgQCBwbHVnaW4gPT4gcGx1Z2luWzBdICYmIGJhYmVsX3BsdWdpbl9pZCA9PT0gcGx1Z2luWzBdLmtleSAmJiBwbHVnaW5bMV1cbiAgICAgICAgICAubWFwIEAgcGx1Z2luID0+IHBsdWdpblsxXVxuICAgICAgICAgIC5wb3AoKVxuICAgICAgICBwYXJzZXJPcHRzLm9mZnNpZGVQbHVnaW5PcHRzID0gb2Zmc2lkZVBsdWdpbk9wdHMgfHwgZGVmYXVsdF9vZmZzaWRlUGx1Z2luT3B0c1xuXG4gICAgLCB2aXNpdG9yOiA6OlxuICAgICAgICBQcm9ncmFtKHBhdGgpIDo6XG4gICAgICAgICAgaWYgdGhpcy5vcHRzLmNoZWNrX2Jsb2NrcyA6OiBlbnN1cmVDb25zaXN0ZW50QmxvY2tJbmRlbnQocGF0aCwgcGF0aC5ub2RlLmJvZHkpXG5cbiAgICAgICwgQmxvY2tTdGF0ZW1lbnQocGF0aCkgOjpcbiAgICAgICAgICBpZiB0aGlzLm9wdHMuY2hlY2tfYmxvY2tzIDo6IGVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudChwYXRoLCBwYXRoLm5vZGUuYm9keSlcblxuICAgICAgLCBTd2l0Y2hTdGF0ZW1lbnQocGF0aCkgOjpcbiAgICAgICAgICBpZiB0aGlzLm9wdHMuY2hlY2tfYmxvY2tzIDo6IGVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudChwYXRoLCBwYXRoLm5vZGUuY2FzZXMpXG5cbiAgICAgICwgU3dpdGNoQ2FzZShwYXRoKSA6OlxuICAgICAgICAgIGlmIHRoaXMub3B0cy5jaGVja19ibG9ja3MgOjogZW5zdXJlQ29uc2lzdGVudEJsb2NrSW5kZW50KHBhdGgsIHBhdGgubm9kZS5jb25zZXF1ZW50KVxuXG5mdW5jdGlvbiBlbnN1cmVDb25zaXN0ZW50QmxvY2tJbmRlbnQocGF0aCwgYm9keSkgOjpcbiAgaWYgbnVsbCA9PSBib2R5IDo6IGJvZHkgPSBwYXRoLm5vZGUuYm9keVxuICBib2R5ID0gQXJyYXkuZnJvbShib2R5KVxuICBpZiAhYm9keSB8fCAhYm9keS5sZW5ndGggOjogcmV0dXJuXG5cbiAgbGV0IHByZXZfbGluZSwgYmxvY2tfY29sdW1uPW51bGxcbiAgZm9yIGNvbnN0IGNoaWxkIG9mIGJvZHkgOjpcbiAgICBjb25zdCBsb2MgPSBjaGlsZC5sb2NcbiAgICBpZiAhbG9jIDo6XG4gICAgICAvLyBBIHN5bnRoZXRpYyBjaGlsZCBvZnRlbiBkb2VzIG5vdCBoYXZlIGEgbG9jYXRpb24uXG4gICAgICAvLyBGdXJ0aGVybW9yZSwgYSBzeW50aGV0aWMgY2hpbGQgaW5kaWNhdGVzIHRoYXQgc29tZXRoaW5nIGlzIG11Y2tpbmdcbiAgICAgIC8vIGFyb3VuZCB3aXRoIHRoZSBBU1QuIEFkYXB0IGJ5IHJlc2V0dGluZyBibG9ja19jb2x1bW4gYW5kIGVuZm9yY2luZ1xuICAgICAgLy8gb25seSBhY3Jvc3MgY29uc2VjdXRpdmUgZW50cmllcyB3aXRoIHZhbGlkIGxvY2F0aW9ucy5cbiAgICAgIGJsb2NrX2NvbHVtbiA9IG51bGxcbiAgICAgIGNvbnRpbnVlXG4gICAgZWxzZSBpZiBudWxsID09PSBibG9ja19jb2x1bW4gOjpcbiAgICAgIC8vIGFzc3VtZSB0aGUgZmlyc3QgbG9jYXRpb24gaXMgaW5kZW50ZWQgcHJvcGVybHnigKZcbiAgICAgIGJsb2NrX2NvbHVtbiA9IGxvYy5zdGFydC5jb2x1bW5cblxuICAgIGlmIGxvYy5zdGFydC5saW5lICE9IHByZXZfbGluZSAmJiBsb2Muc3RhcnQuY29sdW1uICE9IGJsb2NrX2NvbHVtbiA6OlxuICAgICAgdGhyb3cgcGF0aC5odWIuZmlsZS5idWlsZENvZGVGcmFtZUVycm9yIEAgY2hpbGQsXG4gICAgICAgIGBJbmRlbnQgbWlzbWF0Y2guIChibG9jazogJHtibG9ja19jb2x1bW59LCBzdGF0ZW1lbnQ6ICR7bG9jLnN0YXJ0LmNvbHVtbn0pLiBcXG5gICtcbiAgICAgICAgYCAgICAoRnJvbSAnY2hlY2tfYmxvY2tzJyBlbmZvcmNlbWVudCBvcHRpb24gb2YgYmFiZWwtcGx1Z2luLW9mZnNpZGUpYFxuXG4gICAgcHJldl9saW5lID0gbG9jLmVuZC5saW5lXG5cblxuT2JqZWN0LmFzc2lnbiBAIGV4cG9ydHMsXG4gIEB7fVxuICAgIGhvb2tCYWJ5bG9uLFxuICAgIHBhcnNlT2Zmc2lkZUluZGV4TWFwLFxuICAgIGVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudCxcbiJdfQ==