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
  '@:': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: true, extraChars: 1, nestOp: '::{}' },
  '@()': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: true, extraChars: 2 },
  '@{}': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: true, extraChars: 2 },
  '@[]': { tokenPre: tt.bracketL, tokenPost: tt.bracketR, nestInner: true, extraChars: 2 }
  // note:  no '@()' -- standardize to use single-char '@ ' instead
  , keyword_args: { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, inKeywordArg: true } };

pp.isForAwait = function (keywordType, type, val) {
  return tt._for === keywordType && tt.name === type && 'await' === val;
};

const rx_offside_op = /(\S+)[ \t]*(\r\n|\r|\n)?/;

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
    const m_op = rx_offside_op.exec(this.input.slice(pos0));
    const str_op = m_op[1];
    const lineEndsWithOp = !!m_op[2];

    let op = at_offside[str_op];
    if (op) {
      if (op.keywordBlock && recentKeyword && tt_offside_keyword_with_args.has(recentKeyword)) {
        op = at_offside.keyword_args;
      } else if (lineEndsWithOp && op.nestInner) {
        // all offside operators at the end of a line implicitly don't nestInner
        op = { __proto__: op, nestInner: false };
      }

      this.finishOffsideOp(op, op.extraChars);

      if (op.nestOp) {
        state.offsideNextOp = at_offside[op.nestOp];
      }
      return;
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

pp.finishOffsideOp = function (op, extraChars) {
  const stack = this.state.offside;
  let stackTop = stack[stack.length - 1];
  let recentKeywordTop;
  if (op.codeBlock) {
    if (stackTop && stackTop.inKeywordArg) {
      // We're at the end of an offside keyword block; restore enclosing ()
      this.popOffside();
      this.state.offsideNextOp = op;
      this.state.offsideRecentTop = stackTop;
      return;
    }

    recentKeywordTop = this.state.offsideRecentTop;
    this.state.offsideRecentTop = null;
  }

  if (extraChars) {
    this.state.pos += extraChars;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL2NvZGUvaW5kZXguanMiXSwibmFtZXMiOlsiYmFieWxvbiIsInJlcXVpcmUiLCJ0dCIsInRva1R5cGVzIiwiX2dfb2Zmc2lkZVBsdWdpbk9wdHMiLCJkZWZhdWx0X29mZnNpZGVQbHVnaW5PcHRzIiwiY2hlY2tfYmxvY2tzIiwiX2Jhc2VfbW9kdWxlX3BhcnNlIiwicGFyc2UiLCJpbnB1dCIsIm9wdGlvbnMiLCJvZmZzaWRlUGx1Z2luT3B0cyIsInVuZGVmaW5lZCIsIlBhcnNlciIsImhvb2tCYWJ5bG9uIiwiYmFzZVByb3RvIiwicHJvdG90eXBlIiwicHAiLCJPYmplY3QiLCJjcmVhdGUiLCJ0Z3RfcGF0Y2giLCJicmFjZUwiLCJmbl91cGRhdGVDb250ZXh0IiwidXBkYXRlQ29udGV4dCIsInByZXZUeXBlIiwiY29uc3RydWN0b3IiLCJFcnJvciIsIl9iYXNlX3BhcnNlIiwiaW5pdE9mZnNpZGUiLCJPZmZzaWRlQnJlYWtvdXQiLCJvZmZzaWRlQnJlYWtvdXQiLCJzdGF0ZSIsIm9mZnNpZGUiLCJvZmZzaWRlTmV4dE9wIiwib2Zmc2lkZV9saW5lcyIsInBhcnNlT2Zmc2lkZUluZGV4TWFwIiwiX3BvcyIsInBvcyIsImRlZmluZVByb3BlcnR5IiwiZW51bWVyYWJsZSIsImdldCIsInNldCIsIm9mZlBvcyIsIm9mZnNpZGVQb3MiLCJ0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzIiwiU2V0IiwiX2lmIiwiX3doaWxlIiwiX2ZvciIsIl9jYXRjaCIsIl9zd2l0Y2giLCJ0dF9vZmZzaWRlX2tleXdvcmRfbG9va2FoZWFkX3NraXAiLCJwYXJlbkwiLCJjb2xvbiIsImNvbW1hIiwiZG90IiwiYXRfb2Zmc2lkZSIsInRva2VuUHJlIiwidG9rZW5Qb3N0IiwiYnJhY2VSIiwibmVzdElubmVyIiwiY29kZUJsb2NrIiwicGFyZW5SIiwiZXh0cmFDaGFycyIsImJyYWNrZXRMIiwiYnJhY2tldFIiLCJrZXl3b3JkQmxvY2siLCJuZXN0T3AiLCJrZXl3b3JkX2FyZ3MiLCJpbktleXdvcmRBcmciLCJpc0ZvckF3YWl0Iiwia2V5d29yZFR5cGUiLCJ0eXBlIiwidmFsIiwibmFtZSIsInJ4X29mZnNpZGVfb3AiLCJfYmFzZV9maW5pc2hUb2tlbiIsImZpbmlzaFRva2VuIiwicmVjZW50S2V5d29yZCIsIm9mZnNpZGVSZWNlbnRLZXl3b3JkIiwiaW5Gb3JBd2FpdCIsImhhcyIsImlzS2V5d29yZEFsbG93ZWQiLCJpc0xvb2thaGVhZCIsImxvb2thaGVhZCIsInZhbHVlIiwiYXQiLCJkb3VibGVDb2xvbiIsInBvczAiLCJzdGFydCIsInBvczEiLCJtX29wIiwiZXhlYyIsInNsaWNlIiwic3RyX29wIiwibGluZUVuZHNXaXRoT3AiLCJvcCIsIl9fcHJvdG9fXyIsImZpbmlzaE9mZnNpZGVPcCIsImVvZiIsImxlbmd0aCIsInBvcE9mZnNpZGUiLCJvZmZzaWRlSW5kZW50IiwibGluZTAiLCJvdXRlckluZGVudCIsImlubmVySW5kZW50IiwiaW5uZXJMaW5lIiwiaW5kZW50IiwibGluZSIsImxhc3QiLCJjdXIiLCJjb250ZW50Iiwib2Zmc2lkZUJsb2NrIiwic3RhY2tUb3AiLCJyZWNlbnRLZXl3b3JkVG9wIiwiY3VyTGluZSIsImZpcnN0Iiwia2V5d29yZE5lc3RlZEluZGVudCIsImluZGVudF9ibG9jayIsImluZGVudF9rZXl3b3JkIiwicG9zTGFzdENvbnRlbnQiLCJzdGFjayIsImlkeCIsInRpcCIsIm9mZnNpZGVSZWNlbnRUb3AiLCJibGsiLCJwdXNoIiwiX2Jhc2Vfc2tpcFNwYWNlIiwic2tpcFNwYWNlIiwiZXJyIiwiX2Jhc2VfcmVhZFRva2VuIiwicmVhZFRva2VuIiwiY29kZSIsInBvcCIsInJ4X29mZnNpZGUiLCJsaW5lcyIsImlkeF9sYXN0Q29udGVudCIsImFucyIsInJlcGxhY2UiLCJtYXRjaCIsInNwbGljZSIsImJhYmVsX3BsdWdpbl9pZCIsIkRhdGUiLCJub3ciLCJpc05vZGVNb2R1bGVEZXBlbmRlbmN5IiwiYUZpbGVQYXRoIiwidGVzdCIsIm1vZHVsZSIsImV4cG9ydHMiLCJiYWJlbCIsInByZSIsIm9wdHMiLCJhc3NpZ24iLCJGdW5jdGlvbiIsImZpbGVuYW1lIiwiUmVnRXhwIiwibWFuaXB1bGF0ZU9wdGlvbnMiLCJwYXJzZXJPcHRzIiwicGx1Z2lucyIsImZpbHRlciIsInBsdWdpbiIsImtleSIsIm1hcCIsInZpc2l0b3IiLCJQcm9ncmFtIiwicGF0aCIsImVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudCIsIm5vZGUiLCJib2R5IiwiQmxvY2tTdGF0ZW1lbnQiLCJTd2l0Y2hTdGF0ZW1lbnQiLCJjYXNlcyIsIlN3aXRjaENhc2UiLCJjb25zZXF1ZW50IiwiQXJyYXkiLCJmcm9tIiwicHJldl9saW5lIiwiYmxvY2tfY29sdW1uIiwiY2hpbGQiLCJsb2MiLCJjb2x1bW4iLCJodWIiLCJmaWxlIiwiYnVpbGRDb2RlRnJhbWVFcnJvciIsImVuZCJdLCJtYXBwaW5ncyI6IkFBQUEsTUFBTUEsVUFBVUMsUUFBUSxTQUFSLENBQWhCO0FBQ0EsTUFBTUMsS0FBS0YsUUFBUUcsUUFBbkI7O0FBRUEsSUFBSUMsb0JBQUo7QUFDQSxNQUFNQyw0QkFDSixFQUFJQyxjQUFjLG1DQUFsQixFQURGOztBQUdBLE1BQU1DLHFCQUFxQlAsUUFBUVEsS0FBbkM7QUFDQVIsUUFBUVEsS0FBUixHQUFnQixDQUFDQyxLQUFELEVBQVFDLE9BQVIsS0FBb0I7QUFDbENOLHlCQUF1Qk0sVUFBVUEsUUFBUUMsaUJBQWxCLEdBQXNDQyxTQUE3RDtBQUNBLFNBQU9MLG1CQUFtQkUsS0FBbkIsRUFBMEJDLE9BQTFCLENBQVA7QUFBeUMsQ0FGM0M7O0FBSUEsTUFBTUcsU0FBU0MsYUFBZjtBQUNBLE1BQU1DLFlBQVlGLE9BQU9HLFNBQXpCO0FBQ0EsTUFBTUMsS0FBS0osT0FBT0csU0FBUCxHQUFtQkUsT0FBT0MsTUFBUCxDQUFjSixTQUFkLENBQTlCOztBQUVBLFNBQVNELFdBQVQsR0FBdUI7QUFDckI7QUFDQTs7QUFFQSxNQUFJRCxNQUFKO0FBQ0EsTUFBSU8sWUFBWXBCLFFBQVFH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c0ksTUFBUCxDQUFnQkosT0FBaEIsRUFDRTtBQUNFdEksYUFERjtBQUVFcUIsc0JBRkY7QUFHRW1JLDZCQUhGLEVBREYiLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzQ29udGVudCI6WyJjb25zdCBiYWJ5bG9uID0gcmVxdWlyZSgnYmFieWxvbicpXG5jb25zdCB0dCA9IGJhYnlsb24udG9rVHlwZXNcblxudmFyIF9nX29mZnNpZGVQbHVnaW5PcHRzXG5jb25zdCBkZWZhdWx0X29mZnNpZGVQbHVnaW5PcHRzID1cbiAgQHt9IGNoZWNrX2Jsb2NrczogL1xcL25vZGVfbW9kdWxlc1xcL3xcXFxcbm9kZV9tb2R1bGVzXFxcXC9cblxuY29uc3QgX2Jhc2VfbW9kdWxlX3BhcnNlID0gYmFieWxvbi5wYXJzZVxuYmFieWxvbi5wYXJzZSA9IChpbnB1dCwgb3B0aW9ucykgPT4gOjpcbiAgX2dfb2Zmc2lkZVBsdWdpbk9wdHMgPSBvcHRpb25zID8gb3B0aW9ucy5vZmZzaWRlUGx1Z2luT3B0cyA6IHVuZGVmaW5lZFxuICByZXR1cm4gX2Jhc2VfbW9kdWxlX3BhcnNlKGlucHV0LCBvcHRpb25zKVxuXG5jb25zdCBQYXJzZXIgPSBob29rQmFieWxvbigpXG5jb25zdCBiYXNlUHJvdG8gPSBQYXJzZXIucHJvdG90eXBlXG5jb25zdCBwcCA9IFBhcnNlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKGJhc2VQcm90bylcblxuZnVuY3Rpb24gaG9va0JhYnlsb24oKSA6OlxuICAvLyBhYnVzZSBCYWJ5bG9uIHRva2VuIHVwZGF0ZUNvbnRleHQgY2FsbGJhY2sgZXh0cmFjdFxuICAvLyB0aGUgcmVmZXJlbmNlIHRvIFBhcnNlclxuXG4gIGxldCBQYXJzZXJcbiAgbGV0IHRndF9wYXRjaCA9IGJhYnlsb24udG9rVHlwZXMuYnJhY2VMXG4gIGxldCBmbl91cGRhdGVDb250ZXh0ID0gdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHRcbiAgdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHQgPSBmdW5jdGlvbiAocHJldlR5cGUpIDo6XG4gICAgdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHQgPSBmbl91cGRhdGVDb250ZXh0XG4gICAgUGFyc2VyID0gdGhpcy5jb25zdHJ1Y3RvclxuXG4gIGJhYnlsb24ucGFyc2UoJ3t9JylcbiAgaWYgKCFQYXJzZXIpIDo6XG4gICAgdGhyb3cgbmV3IEVycm9yIEAgXCJGYWlsZWQgdG8gaG9vayBCYWJ5bG9uIFBhcnNlclwiXG4gIHJldHVybiBQYXJzZXJcblxuXG5cbnBwLl9iYXNlX3BhcnNlID0gYmFzZVByb3RvLnBhcnNlXG5wcC5wYXJzZSA9IGZ1bmN0aW9uKCkgOjpcbiAgdGhpcy5pbml0T2Zmc2lkZSgpXG4gIHJldHVybiB0aGlzLl9iYXNlX3BhcnNlKClcblxuXG5jbGFzcyBPZmZzaWRlQnJlYWtvdXQgZXh0ZW5kcyBFcnJvciB7fVxuY29uc3Qgb2Zmc2lkZUJyZWFrb3V0ID0gbmV3IE9mZnNpZGVCcmVha291dCgpXG5cbnBwLmluaXRPZmZzaWRlID0gZnVuY3Rpb24oKSA6OlxuICB0aGlzLnN0YXRlLm9mZnNpZGUgPSBbXVxuICB0aGlzLnN0YXRlLm9mZnNpZGVOZXh0T3AgPSBudWxsXG4gIHRoaXMub2Zmc2lkZV9saW5lcyA9IHBhcnNlT2Zmc2lkZUluZGV4TWFwKHRoaXMuaW5wdXQpXG4gIHRoaXMub2Zmc2lkZVBsdWdpbk9wdHMgPSBfZ19vZmZzaWRlUGx1Z2luT3B0cyB8fCB7fVxuICBfZ19vZmZzaWRlUGx1Z2luT3B0cyA9IG51bGxcblxuICB0aGlzLnN0YXRlLl9wb3MgPSB0aGlzLnN0YXRlLnBvc1xuICBPYmplY3QuZGVmaW5lUHJvcGVydHkgQCB0aGlzLnN0YXRlLCAncG9zJyxcbiAgICBAe30gZW51bWVyYWJsZTogdHJ1ZVxuICAgICAgLCBnZXQoKSA6OiByZXR1cm4gdGhpcy5fcG9zXG4gICAgICAsIHNldChwb3MpIDo6XG4gICAgICAgICAgLy8gaW50ZXJydXB0IHNraXBTcGFjZSBhbGdvcml0aG0gd2hlbiB3ZSBoaXQgb3VyIHBvc2l0aW9uICdicmVha3BvaW50J1xuICAgICAgICAgIGxldCBvZmZQb3MgPSB0aGlzLm9mZnNpZGVQb3NcbiAgICAgICAgICBpZiAob2ZmUG9zPj0wICYmIChwb3MgPiBvZmZQb3MpKSA6OlxuICAgICAgICAgICAgdGhyb3cgb2Zmc2lkZUJyZWFrb3V0XG5cbiAgICAgICAgICB0aGlzLl9wb3MgPSBwb3NcblxuXG5sZXQgdHRfb2Zmc2lkZV9rZXl3b3JkX3dpdGhfYXJncyA9IG5ldyBTZXQgQFxuICBAW10gdHQuX2lmLCB0dC5fd2hpbGUsIHR0Ll9mb3JcbiAgICAsIHR0Ll9jYXRjaCwgdHQuX3N3aXRjaFxuXG5sZXQgdHRfb2Zmc2lkZV9rZXl3b3JkX2xvb2thaGVhZF9za2lwID0gbmV3IFNldCBAXG4gIEBbXSB0dC5wYXJlbkwsIHR0LmNvbG9uLCB0dC5jb21tYSwgdHQuZG90XG5cbmxldCBhdF9vZmZzaWRlID1cbiAgQHt9ICc6Oic6ICAge3Rva2VuUHJlOiB0dC5icmFjZUwsIHRva2VuUG9zdDogdHQuYnJhY2VSLCBuZXN0SW5uZXI6IGZhbHNlLCBjb2RlQmxvY2s6IHRydWV9XG4gICAgLCAnOjpAJzogIHt0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiBmYWxzZSwgZXh0cmFDaGFyczogMX1cbiAgICAsICc6OigpJzoge3Rva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IGZhbHNlLCBleHRyYUNoYXJzOiAyfVxuICAgICwgJzo6e30nOiB7dG9rZW5QcmU6IHR0LmJyYWNlTCwgdG9rZW5Qb3N0OiB0dC5icmFjZVIsIG5lc3RJbm5lcjogZmFsc2UsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnOjpbXSc6IHt0b2tlblByZTogdHQuYnJhY2tldEwsIHRva2VuUG9zdDogdHQuYnJhY2tldFIsIG5lc3RJbm5lcjogZmFsc2UsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnQCc6ICAgIHt0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiB0cnVlLCBrZXl3b3JkQmxvY2s6IHRydWV9XG4gICAgLCAnQDonOiAgIHt0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiB0cnVlLCBleHRyYUNoYXJzOiAxLCBuZXN0T3A6ICc6Ont9J31cbiAgICAsICdAKCknOiAge3Rva2VuUHJlOiB0dC5icmFjZUwsIHRva2VuUG9zdDogdHQuYnJhY2VSLCBuZXN0SW5uZXI6IHRydWUsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnQHt9JzogIHt0b2tlblByZTogdHQuYnJhY2VMLCB0b2tlblBvc3Q6IHR0LmJyYWNlUiwgbmVzdElubmVyOiB0cnVlLCBleHRyYUNoYXJzOiAyfVxuICAgICwgJ0BbXSc6ICB7dG9rZW5QcmU6IHR0LmJyYWNrZXRMLCB0b2tlblBvc3Q6IHR0LmJyYWNrZXRSLCBuZXN0SW5uZXI6IHRydWUsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLy8gbm90ZTogIG5vICdAKCknIC0tIHN0YW5kYXJkaXplIHRvIHVzZSBzaW5nbGUtY2hhciAnQCAnIGluc3RlYWRcbiAgICAsIGtleXdvcmRfYXJnczoge3Rva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IGZhbHNlLCBpbktleXdvcmRBcmc6IHRydWV9XG5cblxucHAuaXNGb3JBd2FpdCA9IGZ1bmN0aW9uIChrZXl3b3JkVHlwZSwgdHlwZSwgdmFsKSA6OlxuICByZXR1cm4gdHQuX2ZvciA9PT0ga2V5d29yZFR5cGVcbiAgICAmJiB0dC5uYW1lID09PSB0eXBlXG4gICAgJiYgJ2F3YWl0JyA9PT0gdmFsXG5cbmNvbnN0IHJ4X29mZnNpZGVfb3AgPSAvKFxcUyspWyBcXHRdKihcXHJcXG58XFxyfFxcbik/L1xuXG5wcC5fYmFzZV9maW5pc2hUb2tlbiA9IGJhc2VQcm90by5maW5pc2hUb2tlblxucHAuZmluaXNoVG9rZW4gPSBmdW5jdGlvbih0eXBlLCB2YWwpIDo6XG4gIGNvbnN0IHN0YXRlID0gdGhpcy5zdGF0ZVxuICBjb25zdCByZWNlbnRLZXl3b3JkID0gc3RhdGUub2Zmc2lkZVJlY2VudEtleXdvcmRcbiAgbGV0IGluRm9yQXdhaXQgPSByZWNlbnRLZXl3b3JkID8gdGhpcy5pc0ZvckF3YWl0KHJlY2VudEtleXdvcmQsIHR5cGUsIHZhbCkgOiBudWxsXG4gIHN0YXRlLm9mZnNpZGVSZWNlbnRLZXl3b3JkID0gbnVsbFxuXG4gIGlmIHR0X29mZnNpZGVfa2V5d29yZF93aXRoX2FyZ3MuaGFzKHR5cGUpIHx8IGluRm9yQXdhaXQgOjpcbiAgICBsZXQgaXNLZXl3b3JkQWxsb3dlZCA9ICF0aGlzLmlzTG9va2FoZWFkXG4gICAgICAmJiB0dC5kb3QgIT09IHN0YXRlLnR5cGVcblxuICAgIGlmICFpc0tleXdvcmRBbGxvd2VkIDo6XG4gICAgICByZXR1cm4gdGhpcy5fYmFzZV9maW5pc2hUb2tlbih0eXBlLCB2YWwpXG5cbiAgICBzdGF0ZS5vZmZzaWRlUmVjZW50S2V5d29yZCA9IGluRm9yQXdhaXQgPyB0dC5fZm9yIDogdHlwZVxuICAgIGNvbnN0IGxvb2thaGVhZCA9IHRoaXMubG9va2FoZWFkKClcblxuICAgIGlmIHR0X29mZnNpZGVfa2V5d29yZF9sb29rYWhlYWRfc2tpcC5oYXMobG9va2FoZWFkLnR5cGUpIDo6XG4gICAgZWxzZSBpZiB0aGlzLmlzRm9yQXdhaXQodHlwZSwgbG9va2FoZWFkLnR5cGUsIGxvb2thaGVhZC52YWx1ZSkgOjpcbiAgICBlbHNlIDo6XG4gICAgICBzdGF0ZS5vZmZzaWRlTmV4dE9wID0gYXRfb2Zmc2lkZS5rZXl3b3JkX2FyZ3NcblxuICAgIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR5cGUsIHZhbClcblxuICBpZiB0eXBlID09PSB0dC5hdCB8fCB0eXBlID09PSB0dC5kb3VibGVDb2xvbiA6OlxuICAgIGNvbnN0IHBvczAgPSBzdGF0ZS5zdGFydCwgcG9zMSA9IHN0YXRlLnBvcyArIDJcbiAgICBjb25zdCBtX29wID0gcnhfb2Zmc2lkZV9vcC5leGVjIEAgdGhpcy5pbnB1dC5zbGljZShwb3MwKVxuICAgIGNvbnN0IHN0cl9vcCA9IG1fb3BbMV1cbiAgICBjb25zdCBsaW5lRW5kc1dpdGhPcCA9ICEhIG1fb3BbMl1cblxuICAgIGxldCBvcCA9IGF0X29mZnNpZGVbc3RyX29wXVxuICAgIGlmIG9wIDo6XG4gICAgICBpZiBvcC5rZXl3b3JkQmxvY2sgJiYgcmVjZW50S2V5d29yZCAmJiB0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzLmhhcyhyZWNlbnRLZXl3b3JkKSA6OlxuICAgICAgICBvcCA9IGF0X29mZnNpZGUua2V5d29yZF9hcmdzXG5cbiAgICAgIGVsc2UgaWYgbGluZUVuZHNXaXRoT3AgJiYgb3AubmVzdElubmVyOjpcbiAgICAgICAgLy8gYWxsIG9mZnNpZGUgb3BlcmF0b3JzIGF0IHRoZSBlbmQgb2YgYSBsaW5lIGltcGxpY2l0bHkgZG9uJ3QgbmVzdElubmVyXG4gICAgICAgIG9wID0gQHt9IF9fcHJvdG9fXzogb3AsIG5lc3RJbm5lcjogZmFsc2VcblxuICAgICAgdGhpcy5maW5pc2hPZmZzaWRlT3Aob3AsIG9wLmV4dHJhQ2hhcnMpXG5cbiAgICAgIGlmIG9wLm5lc3RPcCA6OlxuICAgICAgICBzdGF0ZS5vZmZzaWRlTmV4dE9wID0gYXRfb2Zmc2lkZVtvcC5uZXN0T3BdXG4gICAgICByZXR1cm5cblxuICBpZiB0dC5lb2YgPT09IHR5cGUgOjpcbiAgICBpZiBzdGF0ZS5vZmZzaWRlLmxlbmd0aCA6OlxuICAgICAgcmV0dXJuIHRoaXMucG9wT2Zmc2lkZSgpXG5cbiAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4odHlwZSwgdmFsKVxuXG5cbnBwLm9mZnNpZGVJbmRlbnQgPSBmdW5jdGlvbiAobGluZTAsIG91dGVySW5kZW50LCBpbm5lckluZGVudCkgOjpcbiAgY29uc3Qgb2Zmc2lkZV9saW5lcyA9IHRoaXMub2Zmc2lkZV9saW5lc1xuXG4gIGlmIChudWxsID09IGlubmVySW5kZW50KSA6OlxuICAgIGNvbnN0IGlubmVyTGluZSA9IG9mZnNpZGVfbGluZXNbbGluZTArMV1cbiAgICBpbm5lckluZGVudCA9IGlubmVyTGluZSA/IGlubmVyTGluZS5pbmRlbnQgOiAnJ1xuXG4gIGxldCBsaW5lPWxpbmUwKzEsIGxhc3Q9b2Zmc2lkZV9saW5lc1tsaW5lMF1cbiAgd2hpbGUgKGxpbmUgPCBvZmZzaWRlX2xpbmVzLmxlbmd0aCkgOjpcbiAgICBjb25zdCBjdXIgPSBvZmZzaWRlX2xpbmVzW2xpbmVdXG4gICAgaWYgKGN1ci5jb250ZW50ICYmIG91dGVySW5kZW50ID49IGN1ci5pbmRlbnQpIDo6XG4gICAgICBsaW5lLS0gLy8gYmFja3VwIHRvIHByZXZpb3VzIGxpbmVcbiAgICAgIGJyZWFrXG5cbiAgICBsaW5lKys7IGxhc3QgPSBjdXJcbiAgICBpZiAoaW5uZXJJbmRlbnQgPiBjdXIuaW5kZW50KSA6OlxuICAgICAgaW5uZXJJbmRlbnQgPSBjdXIuaW5kZW50XG5cbiAgcmV0dXJuIEB7fSBsaW5lLCBsYXN0LCBpbm5lckluZGVudFxuXG5cbnBwLm9mZnNpZGVCbG9jayA9IGZ1bmN0aW9uIChvcCwgc3RhY2tUb3AsIHJlY2VudEtleXdvcmRUb3ApIDo6XG4gIGxldCBvZmZzaWRlX2xpbmVzID0gdGhpcy5vZmZzaWRlX2xpbmVzXG5cbiAgY29uc3QgbGluZTAgPSB0aGlzLnN0YXRlLmN1ckxpbmVcbiAgY29uc3QgZmlyc3QgPSBvZmZzaWRlX2xpbmVzW2xpbmUwXVxuXG4gIGxldCBpbmRlbnQsIGtleXdvcmROZXN0ZWRJbmRlbnRcbiAgaWYgKHJlY2VudEtleXdvcmRUb3ApIDo6XG4gICAgaW5kZW50ID0gcmVjZW50S2V5d29yZFRvcC5maXJzdC5pbmRlbnRcbiAgZWxzZSBpZiAob3AubmVzdElubmVyICYmIHN0YWNrVG9wICYmIGxpbmUwID09PSBzdGFja1RvcC5maXJzdC5saW5lKSA6OlxuICAgIGluZGVudCA9IHN0YWNrVG9wLmlubmVySW5kZW50XG4gIGVsc2UgaWYgKG9wLmluS2V5d29yZEFyZykgOjpcbiAgICBpbmRlbnQgPSBmaXJzdC5pbmRlbnRcbiAgICBjb25zdCBpbmRlbnRfYmxvY2sgPSB0aGlzLm9mZnNpZGVJbmRlbnQobGluZTAsIGluZGVudClcbiAgICBjb25zdCBpbmRlbnRfa2V5d29yZCA9IHRoaXMub2Zmc2lkZUluZGVudChsaW5lMCwgaW5kZW50X2Jsb2NrLmlubmVySW5kZW50KVxuICAgIGlmIChpbmRlbnRfa2V5d29yZC5pbm5lckluZGVudCA+IGluZGVudF9ibG9jay5pbm5lckluZGVudCkgOjpcbiAgICAgIC8vIGF1dG9kZXRlY3Qga2V5d29yZCBhcmd1bWVudCB1c2luZyAnQCcgZm9yIGZ1bmN0aW9uIGNhbGxzXG4gICAgICBpbmRlbnQgPSBpbmRlbnRfYmxvY2suaW5uZXJJbmRlbnRcbiAgICAgIGtleXdvcmROZXN0ZWRJbmRlbnQgPSBpbmRlbnRfa2V5d29yZC5pbm5lckluZGVudFxuICBlbHNlIDo6XG4gICAgaW5kZW50ID0gZmlyc3QuaW5kZW50XG5cbiAgbGV0IHtsYXN0LCBpbm5lckluZGVudH0gPSB0aGlzLm9mZnNpZGVJbmRlbnQobGluZTAsIGluZGVudCwga2V5d29yZE5lc3RlZEluZGVudClcblxuICAvLyBjYXAgdG8gXG4gIGlubmVySW5kZW50ID0gZmlyc3QuaW5kZW50ID4gaW5uZXJJbmRlbnRcbiAgICA/IGZpcnN0LmluZGVudCA6IGlubmVySW5kZW50XG5cbiAgaWYgc3RhY2tUb3AgJiYgc3RhY2tUb3AubGFzdC5wb3NMYXN0Q29udGVudCA8IGxhc3QucG9zTGFzdENvbnRlbnQ6OlxuICAgIC8vIEZpeHVwIGVuY2xvc2luZyBzY29wZXMuIEhhcHBlbnMgaW4gc2l0dWF0aW9ucyBsaWtlOiBgc2VydmVyLm9uIEAgd3JhcGVyIEAgKC4uLmFyZ3MpID0+IDo6YFxuICAgIGNvbnN0IHN0YWNrID0gdGhpcy5zdGF0ZS5vZmZzaWRlXG4gICAgZm9yIGxldCBpZHggPSBzdGFjay5sZW5ndGgtMTsgaWR4PjA7IGlkeC0tIDo6XG4gICAgICBsZXQgdGlwID0gc3RhY2tbaWR4XVxuICAgICAgaWYgdGlwLmxhc3QucG9zTGFzdENvbnRlbnQgPj0gbGFzdC5wb3NMYXN0Q29udGVudCA6OiBicmVha1xuICAgICAgdGlwLmxhc3QgPSBsYXN0XG5cbiAgcmV0dXJuIHtvcCwgaW5uZXJJbmRlbnQsIGZpcnN0LCBsYXN0fVxuXG5cblxucHAuZmluaXNoT2Zmc2lkZU9wID0gZnVuY3Rpb24gKG9wLCBleHRyYUNoYXJzKSA6OlxuICBjb25zdCBzdGFjayA9IHRoaXMuc3RhdGUub2Zmc2lkZVxuICBsZXQgc3RhY2tUb3AgPSBzdGFja1tzdGFjay5sZW5ndGggLSAxXVxuICBsZXQgcmVjZW50S2V5d29yZFRvcFxuICBpZiAob3AuY29kZUJsb2NrKSA6OlxuICAgIGlmIChzdGFja1RvcCAmJiBzdGFja1RvcC5pbktleXdvcmRBcmcpIDo6XG4gICAgICAvLyBXZSdyZSBhdCB0aGUgZW5kIG9mIGFuIG9mZnNpZGUga2V5d29yZCBibG9jazsgcmVzdG9yZSBlbmNsb3NpbmcgKClcbiAgICAgIHRoaXMucG9wT2Zmc2lkZSgpXG4gICAgICB0aGlzLnN0YXRlLm9mZnNpZGVOZXh0T3AgPSBvcFxuICAgICAgdGhpcy5zdGF0ZS5vZmZzaWRlUmVjZW50VG9wID0gc3RhY2tUb3BcbiAgICAgIHJldHVyblxuXG4gICAgcmVjZW50S2V5d29yZFRvcCA9IHRoaXMuc3RhdGUub2Zmc2lkZVJlY2VudFRvcFxuICAgIHRoaXMuc3RhdGUub2Zmc2lkZVJlY2VudFRvcCA9IG51bGxcblxuICBpZiBleHRyYUNoYXJzIDo6XG4gICAgdGhpcy5zdGF0ZS5wb3MgKz0gZXh0cmFDaGFyc1xuXG4gIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4ob3AudG9rZW5QcmUpXG5cbiAgaWYgKHRoaXMuaXNMb29rYWhlYWQpIDo6IHJldHVyblxuXG4gIHN0YWNrVG9wID0gc3RhY2tbc3RhY2subGVuZ3RoIC0gMV1cbiAgbGV0IGJsayA9IHRoaXMub2Zmc2lkZUJsb2NrKG9wLCBzdGFja1RvcCwgcmVjZW50S2V5d29yZFRvcClcbiAgYmxrLmluS2V5d29yZEFyZyA9IG9wLmluS2V5d29yZEFyZyB8fCBzdGFja1RvcCAmJiBzdGFja1RvcC5pbktleXdvcmRBcmdcbiAgdGhpcy5zdGF0ZS5vZmZzaWRlLnB1c2goYmxrKVxuXG5cbnBwLl9iYXNlX3NraXBTcGFjZSA9IGJhc2VQcm90by5za2lwU3BhY2VcbnBwLnNraXBTcGFjZSA9IGZ1bmN0aW9uKCkgOjpcbiAgaWYgKG51bGwgIT09IHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCkgOjogcmV0dXJuXG5cbiAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YXRlLm9mZnNpZGVcbiAgbGV0IHN0YWNrVG9wXG4gIGlmIChzdGFjayAmJiBzdGFjay5sZW5ndGgpIDo6XG4gICAgc3RhY2tUb3AgPSBzdGFja1tzdGFjay5sZW5ndGgtMV1cbiAgICB0aGlzLnN0YXRlLm9mZnNpZGVQb3MgPSBzdGFja1RvcC5sYXN0LnBvc0xhc3RDb250ZW50XG4gIGVsc2UgOjogdGhpcy5zdGF0ZS5vZmZzaWRlUG9zID0gLTFcblxuICB0cnkgOjpcbiAgICB0aGlzLl9iYXNlX3NraXBTcGFjZSgpXG4gICAgdGhpcy5zdGF0ZS5vZmZzaWRlUG9zID0gLTFcbiAgY2F0Y2ggKGVycikgOjpcbiAgICBpZiAoZXJyICE9PSBvZmZzaWRlQnJlYWtvdXQpIDo6IHRocm93IGVyclxuXG5cbnBwLl9iYXNlX3JlYWRUb2tlbiA9IGJhc2VQcm90by5yZWFkVG9rZW5cbnBwLnJlYWRUb2tlbiA9IGZ1bmN0aW9uKGNvZGUpIDo6XG4gIGNvbnN0IG9mZnNpZGVOZXh0T3AgPSB0aGlzLnN0YXRlLm9mZnNpZGVOZXh0T3BcbiAgaWYgKG51bGwgIT09IG9mZnNpZGVOZXh0T3ApIDo6XG4gICAgdGhpcy5zdGF0ZS5vZmZzaWRlTmV4dE9wID0gbnVsbFxuICAgIHJldHVybiB0aGlzLmZpbmlzaE9mZnNpZGVPcChvZmZzaWRlTmV4dE9wKVxuXG4gIGVsc2UgaWYgKHRoaXMuc3RhdGUucG9zID09PSB0aGlzLnN0YXRlLm9mZnNpZGVQb3MpIDo6XG4gICAgcmV0dXJuIHRoaXMucG9wT2Zmc2lkZSgpXG5cbiAgZWxzZSA6OlxuICAgIHJldHVybiB0aGlzLl9iYXNlX3JlYWRUb2tlbihjb2RlKVxuXG5wcC5wb3BPZmZzaWRlID0gZnVuY3Rpb24oKSA6OlxuICBjb25zdCBzdGFjayA9IHRoaXMuc3RhdGUub2Zmc2lkZVxuICBsZXQgc3RhY2tUb3AgPSB0aGlzLmlzTG9va2FoZWFkXG4gICAgPyBzdGFja1tzdGFjay5sZW5ndGgtMV1cbiAgICA6IHN0YWNrLnBvcCgpXG4gIHRoaXMuc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG5cbiAgdGhpcy5fYmFzZV9maW5pc2hUb2tlbihzdGFja1RvcC5vcC50b2tlblBvc3QpXG4gIHJldHVybiBzdGFja1RvcFxuXG5cblxuY29uc3Qgcnhfb2Zmc2lkZSA9IC9eKFsgXFx0XSopKC4qKSQvbWdcbmZ1bmN0aW9uIHBhcnNlT2Zmc2lkZUluZGV4TWFwKGlucHV0KSA6OlxuICBsZXQgbGluZXMgPSBbbnVsbF0sIHBvc0xhc3RDb250ZW50PTAsIGxhc3Q9WycnLCAwXVxuICBsZXQgaWR4X2xhc3RDb250ZW50PTBcblxuICBsZXQgYW5zID0gaW5wdXQucmVwbGFjZSBAIHJ4X29mZnNpZGUsIChtYXRjaCwgaW5kZW50LCBjb250ZW50LCBwb3MpID0+IDo6XG4gICAgaWYgKCFjb250ZW50KSA6OlxuICAgICAgW2luZGVudCwgcG9zTGFzdENvbnRlbnRdID0gbGFzdCAvLyBibGFuayBsaW5lOyB1c2UgbGFzdCB2YWxpZCBjb250ZW50IGFzIGVuZFxuICAgIGVsc2UgOjpcbiAgICAgIC8vIHZhbGlkIGNvbnRlbnQ7IHNldCBsYXN0IHRvIGN1cnJlbnQgaW5kZW50XG4gICAgICBwb3NMYXN0Q29udGVudCA9IHBvcyArIG1hdGNoLmxlbmd0aFxuICAgICAgaWR4X2xhc3RDb250ZW50ID0gbGluZXMubGVuZ3RoXG4gICAgICBsYXN0ID0gW2luZGVudCwgcG9zTGFzdENvbnRlbnRdXG4gICAgbGluZXMucHVzaCh7bGluZTogbGluZXMubGVuZ3RoLCBwb3NMYXN0Q29udGVudCwgaW5kZW50LCBjb250ZW50fSlcbiAgICByZXR1cm4gJydcblxuICBsaW5lcy5zcGxpY2UoMStpZHhfbGFzdENvbnRlbnQpIC8vIHRyaW0gdHJhaWxpbmcgd2hpdGVzcGFjZVxuICByZXR1cm4gbGluZXNcblxuXG5jb25zdCBiYWJlbF9wbHVnaW5faWQgPSBgYmFiZWwtcGx1Z2luLW9mZnNpZGUtLSR7RGF0ZS5ub3coKX1gXG5cbmNvbnN0IGlzTm9kZU1vZHVsZURlcGVuZGVuY3kgPSBhRmlsZVBhdGggPT5cbiAgL1xcL25vZGVfbW9kdWxlc1xcL3xcXFxcbm9kZV9tb2R1bGVzXFxcXC8udGVzdCBAIGFGaWxlUGF0aFxubW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzID0gKGJhYmVsKSA9PiA6OlxuICByZXR1cm4gOjpcbiAgICBuYW1lOiBiYWJlbF9wbHVnaW5faWRcbiAgICAsIHByZShzdGF0ZSkgOjpcbiAgICAgICAgdGhpcy5vcHRzID0gT2JqZWN0LmFzc2lnbiBAIHt9LCBkZWZhdWx0X29mZnNpZGVQbHVnaW5PcHRzLCB0aGlzLm9wdHNcblxuICAgICAgICBsZXQgY2hlY2tfYmxvY2tzID0gdGhpcy5vcHRzLmNoZWNrX2Jsb2Nrc1xuICAgICAgICBpZiBjaGVja19ibG9ja3MgaW5zdGFuY2VvZiBGdW5jdGlvbiA6OlxuICAgICAgICAgIGNoZWNrX2Jsb2NrcyA9IGNoZWNrX2Jsb2NrcyBAIHN0YXRlLm9wdHMuZmlsZW5hbWVcbiAgICAgICAgZWxzZSBpZiBjaGVja19ibG9ja3MgaW5zdGFuY2VvZiBSZWdFeHAgOjpcbiAgICAgICAgICBjaGVja19ibG9ja3MgPSAhIGNoZWNrX2Jsb2Nrcy50ZXN0IEAgc3RhdGUub3B0cy5maWxlbmFtZVxuICAgICAgICBlbHNlIGlmICdzdHJpbmcnID09PSB0eXBlb2YgY2hlY2tfYmxvY2tzIDo6XG4gICAgICAgICAgY2hlY2tfYmxvY2tzID0gISBuZXcgUmVnRXhwKGNoZWNrX2Jsb2NrcykudGVzdCBAIHN0YXRlLm9wdHMuZmlsZW5hbWVcblxuICAgICAgICB0aGlzLm9wdHMuY2hlY2tfYmxvY2tzID0gY2hlY2tfYmxvY2tzID0gISEgY2hlY2tfYmxvY2tzXG5cbiAgICAvLywgcG9zdChzdGF0ZSkgOjogY29uc29sZS5kaXIgQCBzdGF0ZS5hc3QucHJvZ3JhbSwgQHt9IGNvbG9yczogdHJ1ZSwgZGVwdGg6IG51bGxcblxuICAgICwgbWFuaXB1bGF0ZU9wdGlvbnMob3B0cywgcGFyc2VyT3B0cykgOjpcbiAgICAgICAgcGFyc2VyT3B0cy5wbHVnaW5zLnB1c2goJ2FzeW5jR2VuZXJhdG9ycycsICdjbGFzc1Byb3BlcnRpZXMnLCAnZGVjb3JhdG9ycycsICdmdW5jdGlvbkJpbmQnKVxuICAgICAgICBjb25zdCBvZmZzaWRlUGx1Z2luT3B0cyA9IG9wdHMucGx1Z2luc1xuICAgICAgICAgIC5maWx0ZXIgQCBwbHVnaW4gPT4gcGx1Z2luWzBdICYmIGJhYmVsX3BsdWdpbl9pZCA9PT0gcGx1Z2luWzBdLmtleSAmJiBwbHVnaW5bMV1cbiAgICAgICAgICAubWFwIEAgcGx1Z2luID0+IHBsdWdpblsxXVxuICAgICAgICAgIC5wb3AoKVxuICAgICAgICBwYXJzZXJPcHRzLm9mZnNpZGVQbHVnaW5PcHRzID0gb2Zmc2lkZVBsdWdpbk9wdHMgfHwgZGVmYXVsdF9vZmZzaWRlUGx1Z2luT3B0c1xuXG4gICAgLCB2aXNpdG9yOiA6OlxuICAgICAgICBQcm9ncmFtKHBhdGgpIDo6XG4gICAgICAgICAgaWYgdGhpcy5vcHRzLmNoZWNrX2Jsb2NrcyA6OiBlbnN1cmVDb25zaXN0ZW50QmxvY2tJbmRlbnQocGF0aCwgcGF0aC5ub2RlLmJvZHkpXG5cbiAgICAgICwgQmxvY2tTdGF0ZW1lbnQocGF0aCkgOjpcbiAgICAgICAgICBpZiB0aGlzLm9wdHMuY2hlY2tfYmxvY2tzIDo6IGVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudChwYXRoLCBwYXRoLm5vZGUuYm9keSlcblxuICAgICAgLCBTd2l0Y2hTdGF0ZW1lbnQocGF0aCkgOjpcbiAgICAgICAgICBpZiB0aGlzLm9wdHMuY2hlY2tfYmxvY2tzIDo6IGVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudChwYXRoLCBwYXRoLm5vZGUuY2FzZXMpXG5cbiAgICAgICwgU3dpdGNoQ2FzZShwYXRoKSA6OlxuICAgICAgICAgIGlmIHRoaXMub3B0cy5jaGVja19ibG9ja3MgOjogZW5zdXJlQ29uc2lzdGVudEJsb2NrSW5kZW50KHBhdGgsIHBhdGgubm9kZS5jb25zZXF1ZW50KVxuXG5mdW5jdGlvbiBlbnN1cmVDb25zaXN0ZW50QmxvY2tJbmRlbnQocGF0aCwgYm9keSkgOjpcbiAgaWYgbnVsbCA9PSBib2R5IDo6IGJvZHkgPSBwYXRoLm5vZGUuYm9keVxuICBib2R5ID0gQXJyYXkuZnJvbShib2R5KVxuICBpZiAhYm9keSB8fCAhYm9keS5sZW5ndGggOjogcmV0dXJuXG5cbiAgbGV0IHByZXZfbGluZSwgYmxvY2tfY29sdW1uPW51bGxcbiAgZm9yIGNvbnN0IGNoaWxkIG9mIGJvZHkgOjpcbiAgICBjb25zdCBsb2MgPSBjaGlsZC5sb2NcbiAgICBpZiAhbG9jIDo6XG4gICAgICAvLyBBIHN5bnRoZXRpYyBjaGlsZCBvZnRlbiBkb2VzIG5vdCBoYXZlIGEgbG9jYXRpb24uXG4gICAgICAvLyBGdXJ0aGVybW9yZSwgYSBzeW50aGV0aWMgY2hpbGQgaW5kaWNhdGVzIHRoYXQgc29tZXRoaW5nIGlzIG11Y2tpbmdcbiAgICAgIC8vIGFyb3VuZCB3aXRoIHRoZSBBU1QuIEFkYXB0IGJ5IHJlc2V0dGluZyBibG9ja19jb2x1bW4gYW5kIGVuZm9yY2luZ1xuICAgICAgLy8gb25seSBhY3Jvc3MgY29uc2VjdXRpdmUgZW50cmllcyB3aXRoIHZhbGlkIGxvY2F0aW9ucy5cbiAgICAgIGJsb2NrX2NvbHVtbiA9IG51bGxcbiAgICAgIGNvbnRpbnVlXG4gICAgZWxzZSBpZiBudWxsID09PSBibG9ja19jb2x1bW4gOjpcbiAgICAgIC8vIGFzc3VtZSB0aGUgZmlyc3QgbG9jYXRpb24gaXMgaW5kZW50ZWQgcHJvcGVybHnigKZcbiAgICAgIGJsb2NrX2NvbHVtbiA9IGxvYy5zdGFydC5jb2x1bW5cblxuICAgIGlmIGxvYy5zdGFydC5saW5lICE9IHByZXZfbGluZSAmJiBsb2Muc3RhcnQuY29sdW1uICE9IGJsb2NrX2NvbHVtbiA6OlxuICAgICAgdGhyb3cgcGF0aC5odWIuZmlsZS5idWlsZENvZGVGcmFtZUVycm9yIEAgY2hpbGQsXG4gICAgICAgIGBJbmRlbnQgbWlzbWF0Y2guIChibG9jazogJHtibG9ja19jb2x1bW59LCBzdGF0ZW1lbnQ6ICR7bG9jLnN0YXJ0LmNvbHVtbn0pLiBcXG5gICtcbiAgICAgICAgYCAgICAoRnJvbSAnY2hlY2tfYmxvY2tzJyBlbmZvcmNlbWVudCBvcHRpb24gb2YgYmFiZWwtcGx1Z2luLW9mZnNpZGUpYFxuXG4gICAgcHJldl9saW5lID0gbG9jLmVuZC5saW5lXG5cblxuT2JqZWN0LmFzc2lnbiBAIGV4cG9ydHMsXG4gIEB7fVxuICAgIGhvb2tCYWJ5bG9uLFxuICAgIHBhcnNlT2Zmc2lkZUluZGV4TWFwLFxuICAgIGVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudCxcbiJdfQ==