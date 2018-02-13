'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.hookBabylon = hookBabylon;
exports.installOffsideBabylonParsers = installOffsideBabylonParsers;
exports.asOffsideJSBabylonParser = asOffsideJSBabylonParser;

var _offside_ops = require('./offside_ops');

function hookBabylon(babylon) {
  // abuse Babylon token updateContext callback extract
  // the reference to Parser

  let Parser;
  const tgt_patch = babylon.tokTypes.braceL;
  const fn_updateContext = tgt_patch.updateContext;
  tgt_patch.updateContext = function (prevType) {
    tgt_patch.updateContext = fn_updateContext;
    Parser = this.constructor;
  };

  babylon.parse('{}');
  if (!Parser) {
    throw new Error("Failed to hook Babylon Parser");
  }
  return Parser;
}function installOffsideBabylonParsers() {
  const hookList = [];

  try {
    hookList.push(require('babylon'));
  } catch (err) {}

  try {
    hookList.push(require('babel-cli/node_modules/babylon'));
  } catch (err) {}

  try {
    hookList.push(require('babel-core/node_modules/babylon'));
  } catch (err) {}

  if (0 === hookList.length) {
    throw new Error(`Unable to load "babylon" parser package`);
  }

  return hookList.map(babylon => asOffsideJSBabylonParser(babylon));
}function asOffsideJSBabylonParser(babylon) {
  // begin per-babylon instance monkeypatching

  const Parser = hookBabylon(babylon);
  const baseProto = Parser.prototype;
  const pp = Parser.prototype = Object.create(baseProto);
  const tt = babylon.tokTypes;

  const at_offside = (0, _offside_ops.offsideOperatorsForBabylon)(tt);

  var _g_offsidePluginOpts;

  const _base_module_parse = babylon.parse;
  babylon.parse = (input, options) => {
    _g_offsidePluginOpts = options ? options.offsidePluginOpts : undefined;
    return _base_module_parse(input, options);
  };

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
    this.state.offsideTokenStack = [];
    this.offside_lines = (0, _offside_ops.parseOffsideIndexMap)(this.input);
    this.offsidePluginOpts = _g_offsidePluginOpts || {};
    _g_offsidePluginOpts = null;

    this.state._pos = this.state.pos;
    Object.defineProperty(this.state, 'pos', {
      enumerable: true,
      get() {
        return this._pos;
      },
      set(pos) {
        // interrupt skipSpace algorithm when we hit our position 'breakpoint'
        const offPos = this.offsidePos;
        if (offPos >= 0 && pos > offPos) {
          throw offsideBreakout;
        }

        this._pos = pos;
      } });
  };

  const tt_offside_keyword_with_args = new Set([tt._if, tt._while, tt._for, tt._catch, tt._switch]);

  const tt_offside_keyword_lookahead_skip = new Set([tt.parenL, tt.colon, tt.comma, tt.dot]);

  pp.isForAwait = function (keywordType, type, val) {
    return tt._for === keywordType && tt.name === type && 'await' === val;
  };

  const rx_offside_op = /(\S+)[ \t]*(\r\n|\r|\n)?/;

  pp.finishTokenStack = function (tokenOrList) {
    if (Array.isArray(tokenOrList)) {
      this.state.offsideTokenStack = tokenOrList.slice(1);
      tokenOrList = tokenOrList[0];
    }

    return this._base_finishToken(tokenOrList);
  };

  pp._base_finishToken = baseProto.finishToken;
  pp.finishToken = function (type, val) {
    const state = this.state;
    const recentKeyword = state.offsideRecentKeyword;
    const inForAwait = recentKeyword ? this.isForAwait(recentKeyword, type, val) : null;
    state.offsideRecentKeyword = null;

    if (tt_offside_keyword_with_args.has(type) || inForAwait) {
      const isKeywordAllowed = !this.isLookahead && tt.dot !== state.type;

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
      if (false === innerIndent) {
        innerIndent = cur.indent;
      } else if (innerIndent > cur.indent) {
        innerIndent = cur.indent;
      }
    }

    return { line, last, innerIndent };
  };

  pp.offsideBlock = function (op, stackTop, recentKeywordTop) {
    const state = this.state;
    const line0 = state.curLine;
    const first = this.offside_lines[line0];

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
      const stack = state.offside;
      for (let idx = stack.length - 1; idx > 0; idx--) {
        let tip = stack[idx];
        if (tip.last.posLastContent >= last.posLastContent) {
          break;
        }
        tip.last = last;
      }
    }

    return { op, innerIndent, first, last,
      start: state.start, end: state.end,
      loc: { start: state.startLoc, end: state.endLoc } };
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

    this.finishTokenStack(op.tokenPre);

    if (this.isLookahead) {
      return;
    }

    stackTop = stack[stack.length - 1];
    const blk = this.offsideBlock(op, stackTop, recentKeywordTop);
    blk.inKeywordArg = op.inKeywordArg || stackTop && stackTop.inKeywordArg;
    this.state.offside.push(blk);
  };

  pp._base_skipSpace = baseProto.skipSpace;
  pp.skipSpace = function () {
    const state = this.state;
    if (null !== state.offsideNextOp) {
      return;
    }

    const stack = state.offside;
    let stackTop;
    if (stack && stack.length) {
      stackTop = stack[stack.length - 1];
      state.offsidePos = stackTop.last.posLastContent;
    } else {
      state.offsidePos = -1;
    }

    try {
      this._base_skipSpace();
      state.offsidePos = -1;

      state.offsideImplicitComma = undefined !== stackTop ? this.offsideCheckImplicitComma(stackTop) : null;
    } catch (err) {
      if (err !== offsideBreakout) {
        throw err;
      }
    }
  };

  const tt_offside_disrupt_implicit_comma = new Set([tt.comma, tt.dot, tt.arrow, tt.colon, tt.semi, tt.question]);

  pp.offsideCheckImplicitComma = function (stackTop) {
    const { implicitCommas } = stackTop.op;
    if (!implicitCommas) {
      return null; // not enabled for this offside op
    }if (!this.offsidePluginOpts.implicit_commas) {
      return null; // not enabled for this offside op
    }const state = this.state,
          state_type = state.type,
          column = state.pos - state.lineStart;
    if (column !== stackTop.innerIndent.length) {
      return null; // not at the exact right indent
    }if (stackTop.end >= state.end) {
      return false; // no comma before the first element
    }if (tt.comma === state_type) {
      return false; // there's an explicit comma already present
    }if (state_type.binop || state_type.beforeExpr) {
      return false; // there's an operator or arrow function preceeding this line
    }if (this.isLookahead) {
      return false; // disallow recursive lookahead
    }const { type: next_type } = this.lookahead();

    if (tt_offside_disrupt_implicit_comma.has(next_type)) {
      return false; // there's a comma, dot, or function arrow token that precludes an implicit leading comma
    }if (next_type.binop) {
      if ('function' === typeof implicitCommas.has) {
        // allow for tt.star in certain contexts — e.g. for generator method defintions
        return implicitCommas.has(next_type);
      }

      return false; // there's a binary operator that precludes an implicit leading comma
    } else {
        return true; // an implicit comma is needed
      }
  };pp._base_readToken = baseProto.readToken;
  pp.readToken = function (code) {
    const state = this.state;

    if (state.offsideTokenStack.length) {
      return this._base_finishToken(state.offsideTokenStack.shift());
    }
    if (state.offsideImplicitComma) {
      return this._base_finishToken(tt.comma);
    }

    const offsideNextOp = state.offsideNextOp;
    if (null !== offsideNextOp) {
      state.offsideNextOp = null;
      return this.finishOffsideOp(offsideNextOp);
    }

    if (state.pos === state.offsidePos) {
      return this.popOffside();
    }

    return this._base_readToken(code);
  };

  pp.popOffside = function () {
    const stack = this.state.offside;
    const stackTop = this.isLookahead ? stack[stack.length - 1] : stack.pop();
    this.state.offsidePos = -1;

    this.finishTokenStack(stackTop.op.tokenPost);
    return stackTop;
  };

  return Parser;
} // end per-babylon instance monkeypatching
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL2NvZGUvcGFyc2VyLmpzIl0sIm5hbWVzIjpbImhvb2tCYWJ5bG9uIiwiaW5zdGFsbE9mZnNpZGVCYWJ5bG9uUGFyc2VycyIsImFzT2Zmc2lkZUpTQmFieWxvblBhcnNlciIsImJhYnlsb24iLCJQYXJzZXIiLCJ0Z3RfcGF0Y2giLCJ0b2tUeXBlcyIsImJyYWNlTCIsImZuX3VwZGF0ZUNvbnRleHQiLCJ1cGRhdGVDb250ZXh0IiwicHJldlR5cGUiLCJjb25zdHJ1Y3RvciIsInBhcnNlIiwiRXJyb3IiLCJob29rTGlzdCIsInB1c2giLCJyZXF1aXJlIiwiZXJyIiwibGVuZ3RoIiwibWFwIiwiYmFzZVByb3RvIiwicHJvdG90eXBlIiwicHAiLCJPYmplY3QiLCJjcmVhdGUiLCJ0dCIsImF0X29mZnNpZGUiLCJfZ19vZmZzaWRlUGx1Z2luT3B0cyIsIl9iYXNlX21vZHVsZV9wYXJzZSIsImlucHV0Iiwib3B0aW9ucyIsIm9mZnNpZGVQbHVnaW5PcHRzIiwidW5kZWZpbmVkIiwiX2Jhc2VfcGFyc2UiLCJpbml0T2Zmc2lkZSIsIk9mZnNpZGVCcmVha291dCIsIm9mZnNpZGVCcmVha291dCIsInN0YXRlIiwib2Zmc2lkZSIsIm9mZnNpZGVOZXh0T3AiLCJvZmZzaWRlVG9rZW5TdGFjayIsIm9mZnNpZGVfbGluZXMiLCJfcG9zIiwicG9zIiwiZGVmaW5lUHJvcGVydHkiLCJlbnVtZXJhYmxlIiwiZ2V0Iiwic2V0Iiwib2ZmUG9zIiwib2Zmc2lkZVBvcyIsInR0X29mZnNpZGVfa2V5d29yZF93aXRoX2FyZ3MiLCJTZXQiLCJfaWYiLCJfd2hpbGUiLCJfZm9yIiwiX2NhdGNoIiwiX3N3aXRjaCIsInR0X29mZnNpZGVfa2V5d29yZF9sb29rYWhlYWRfc2tpcCIsInBhcmVuTCIsImNvbG9uIiwiY29tbWEiLCJkb3QiLCJpc0ZvckF3YWl0Iiwia2V5d29yZFR5cGUiLCJ0eXBlIiwidmFsIiwibmFtZSIsInJ4X29mZnNpZGVfb3AiLCJmaW5pc2hUb2tlblN0YWNrIiwidG9rZW5Pckxpc3QiLCJBcnJheSIsImlzQXJyYXkiLCJzbGljZSIsIl9iYXNlX2ZpbmlzaFRva2VuIiwiZmluaXNoVG9rZW4iLCJyZWNlbnRLZXl3b3JkIiwib2Zmc2lkZVJlY2VudEtleXdvcmQiLCJpbkZvckF3YWl0IiwiaGFzIiwiaXNLZXl3b3JkQWxsb3dlZCIsImlzTG9va2FoZWFkIiwibG9va2FoZWFkIiwidmFsdWUiLCJrZXl3b3JkX2FyZ3MiLCJhdCIsImRvdWJsZUNvbG9uIiwicG9zMCIsInN0YXJ0IiwicG9zMSIsIm1fb3AiLCJleGVjIiwic3RyX29wIiwibGluZUVuZHNXaXRoT3AiLCJvcCIsImtleXdvcmRCbG9jayIsIm5lc3RJbm5lciIsIl9fcHJvdG9fXyIsImZpbmlzaE9mZnNpZGVPcCIsImV4dHJhQ2hhcnMiLCJuZXN0T3AiLCJlb2YiLCJwb3BPZmZzaWRlIiwib2Zmc2lkZUluZGVudCIsImxpbmUwIiwib3V0ZXJJbmRlbnQiLCJpbm5lckluZGVudCIsImlubmVyTGluZSIsImluZGVudCIsImxpbmUiLCJsYXN0IiwiY3VyIiwiY29udGVudCIsIm9mZnNpZGVCbG9jayIsInN0YWNrVG9wIiwicmVjZW50S2V5d29yZFRvcCIsImN1ckxpbmUiLCJmaXJzdCIsImtleXdvcmROZXN0ZWRJbmRlbnQiLCJpbktleXdvcmRBcmciLCJpbmRlbnRfYmxvY2siLCJpbmRlbnRfa2V5d29yZCIsInBvc0xhc3RDb250ZW50Iiwic3RhY2siLCJpZHgiLCJ0aXAiLCJlbmQiLCJsb2MiLCJzdGFydExvYyIsImVuZExvYyIsImNvZGVCbG9jayIsIm9mZnNpZGVSZWNlbnRUb3AiLCJ0b2tlblByZSIsImJsayIsIl9iYXNlX3NraXBTcGFjZSIsInNraXBTcGFjZSIsIm9mZnNpZGVJbXBsaWNpdENvbW1hIiwib2Zmc2lkZUNoZWNrSW1wbGljaXRDb21tYSIsInR0X29mZnNpZGVfZGlzcnVwdF9pbXBsaWNpdF9jb21tYSIsImFycm93Iiwic2VtaSIsInF1ZXN0aW9uIiwiaW1wbGljaXRDb21tYXMiLCJpbXBsaWNpdF9jb21tYXMiLCJzdGF0ZV90eXBlIiwiY29sdW1uIiwibGluZVN0YXJ0IiwiYmlub3AiLCJiZWZvcmVFeHByIiwibmV4dF90eXBlIiwiX2Jhc2VfcmVhZFRva2VuIiwicmVhZFRva2VuIiwiY29kZSIsInNoaWZ0IiwicG9wIiwidG9rZW5Qb3N0Il0sIm1hcHBpbmdzIjoiOzs7OztRQUVnQkEsVyxHQUFBQSxXO1FBaUJBQyw0QixHQUFBQSw0QjtRQXNCQUMsd0IsR0FBQUEsd0I7O0FBekNoQjs7QUFFTyxTQUFTRixXQUFULENBQXFCRyxPQUFyQixFQUE4QjtBQUNuQztBQUNBOztBQUVBLE1BQUlDLE1BQUo7QUFDQSxRQUFNQyxZQUFZRixRQUFRRyxRQUFSLENBQWlCQyxNQUFuQztBQUNBLFFBQU1DLG1CQUFtQkgsVUFBVUksYUFBbkM7QUFDQUosWUFBVUksYUFBVixHQUEwQixVQUFVQyxRQUFWLEVBQW9CO0FBQzVDTCxjQUFVSSxhQUFWLEdBQTBCRCxnQkFBMUI7QUFDQUosYUFBUyxLQUFLTyxXQUFkO0FBQXlCLEdBRjNCOztBQUlBUixVQUFRUyxLQUFSLENBQWMsSUFBZDtBQUNBLE1BQUcsQ0FBRVIsTUFBTCxFQUFjO0FBQ1osVUFBTSxJQUFJUyxLQUFKLENBQVksK0JBQVosQ0FBTjtBQUFpRDtBQUNuRCxTQUFPVCxNQUFQO0FBQWEsQ0FHUixTQUFTSCw0QkFBVCxHQUF3QztBQUM3QyxRQUFNYSxXQUFXLEVBQWpCOztBQUVBLE1BQUk7QUFBR0EsYUFBU0MsSUFBVCxDQUNMQyxRQUFRLFNBQVIsQ0FESztBQUNhLEdBRHBCLENBRUEsT0FBTUMsR0FBTixFQUFZOztBQUVaLE1BQUk7QUFBR0gsYUFBU0MsSUFBVCxDQUNMQyxRQUFRLGdDQUFSLENBREs7QUFDb0MsR0FEM0MsQ0FFQSxPQUFNQyxHQUFOLEVBQVk7O0FBRVosTUFBSTtBQUFHSCxhQUFTQyxJQUFULENBQ0xDLFFBQVEsaUNBQVIsQ0FESztBQUNxQyxHQUQ1QyxDQUVBLE9BQU1DLEdBQU4sRUFBWTs7QUFFWixNQUFHLE1BQU1ILFNB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O0FBQzlCLGFBQU8sS0FBSzlELGlCQUFMLENBQXVCaEQsR0FBR21DLEtBQTFCLENBQVA7QUFBdUM7O0FBRXpDLFVBQU1yQixnQkFBZ0JGLE1BQU1FLGFBQTVCO0FBQ0EsUUFBRyxTQUFTQSxhQUFaLEVBQTRCO0FBQzFCRixZQUFNRSxhQUFOLEdBQXNCLElBQXRCO0FBQ0EsYUFBTyxLQUFLMEQsZUFBTCxDQUFxQjFELGFBQXJCLENBQVA7QUFBMEM7O0FBRTVDLFFBQUdGLE1BQU1NLEdBQU4sS0FBY04sTUFBTVksVUFBdkIsRUFBb0M7QUFDbEMsYUFBTyxLQUFLb0QsVUFBTCxFQUFQO0FBQXdCOztBQUUxQixXQUFPLEtBQUtnRCxlQUFMLENBQXFCRSxJQUFyQixDQUFQO0FBQWlDLEdBakJuQzs7QUFtQkFqSSxLQUFHK0UsVUFBSCxHQUFnQixZQUFXO0FBQ3pCLFVBQU1xQixRQUFRLEtBQUtyRixLQUFMLENBQVdDLE9BQXpCO0FBQ0EsVUFBTTJFLFdBQVcsS0FBS2pDLFdBQUwsR0FDYjBDLE1BQU1BLE1BQU14RyxNQUFOLEdBQWEsQ0FBbkIsQ0FEYSxHQUVid0csTUFBTStCLEdBQU4sRUFGSjtBQUdBLFNBQUtwSCxLQUFMLENBQVdZLFVBQVgsR0FBd0IsQ0FBQyxDQUF6Qjs7QUFFQSxTQUFLbUIsZ0JBQUwsQ0FBc0I2QyxTQUFTcEIsRUFBVCxDQUFZNkQsU0FBbEM7QUFDQSxXQUFPekMsUUFBUDtBQUFlLEdBUmpCOztBQVdBLFNBQU83RyxNQUFQO0FBQ0MsQyxDQUFDIiwiZmlsZSI6InBhcnNlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7b2Zmc2lkZU9wZXJhdG9yc0ZvckJhYnlsb24sIHBhcnNlT2Zmc2lkZUluZGV4TWFwfSBmcm9tICcuL29mZnNpZGVfb3BzJ1xuXG5leHBvcnQgZnVuY3Rpb24gaG9va0JhYnlsb24oYmFieWxvbikgOjpcbiAgLy8gYWJ1c2UgQmFieWxvbiB0b2tlbiB1cGRhdGVDb250ZXh0IGNhbGxiYWNrIGV4dHJhY3RcbiAgLy8gdGhlIHJlZmVyZW5jZSB0byBQYXJzZXJcblxuICBsZXQgUGFyc2VyXG4gIGNvbnN0IHRndF9wYXRjaCA9IGJhYnlsb24udG9rVHlwZXMuYnJhY2VMXG4gIGNvbnN0IGZuX3VwZGF0ZUNvbnRleHQgPSB0Z3RfcGF0Y2gudXBkYXRlQ29udGV4dFxuICB0Z3RfcGF0Y2gudXBkYXRlQ29udGV4dCA9IGZ1bmN0aW9uIChwcmV2VHlwZSkgOjpcbiAgICB0Z3RfcGF0Y2gudXBkYXRlQ29udGV4dCA9IGZuX3VwZGF0ZUNvbnRleHRcbiAgICBQYXJzZXIgPSB0aGlzLmNvbnN0cnVjdG9yXG5cbiAgYmFieWxvbi5wYXJzZSgne30nKVxuICBpZiAhIFBhcnNlciA6OlxuICAgIHRocm93IG5ldyBFcnJvciBAIFwiRmFpbGVkIHRvIGhvb2sgQmFieWxvbiBQYXJzZXJcIlxuICByZXR1cm4gUGFyc2VyXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGluc3RhbGxPZmZzaWRlQmFieWxvblBhcnNlcnMoKSA6OlxuICBjb25zdCBob29rTGlzdCA9IFtdXG5cbiAgdHJ5IDo6IGhvb2tMaXN0LnB1c2ggQFxuICAgIHJlcXVpcmUoJ2JhYnlsb24nKVxuICBjYXRjaCBlcnIgOjpcblxuICB0cnkgOjogaG9va0xpc3QucHVzaCBAXG4gICAgcmVxdWlyZSgnYmFiZWwtY2xpL25vZGVfbW9kdWxlcy9iYWJ5bG9uJylcbiAgY2F0Y2ggZXJyIDo6XG5cbiAgdHJ5IDo6IGhvb2tMaXN0LnB1c2ggQFxuICAgIHJlcXVpcmUoJ2JhYmVsLWNvcmUvbm9kZV9tb2R1bGVzL2JhYnlsb24nKVxuICBjYXRjaCBlcnIgOjpcblxuICBpZiAwID09PSBob29rTGlzdC5sZW5ndGggOjpcbiAgICB0aHJvdyBuZXcgRXJyb3IgQCBgVW5hYmxlIHRvIGxvYWQgXCJiYWJ5bG9uXCIgcGFyc2VyIHBhY2thZ2VgXG5cbiAgcmV0dXJuIGhvb2tMaXN0Lm1hcCBAIGJhYnlsb24gPT5cbiAgICBhc09mZnNpZGVKU0JhYnlsb25QYXJzZXIoYmFieWxvbilcbiAgXG5cbmV4cG9ydCBmdW5jdGlvbiBhc09mZnNpZGVKU0JhYnlsb25QYXJzZXIoYmFieWxvbilcbnsgLy8gYmVnaW4gcGVyLWJhYnlsb24gaW5zdGFuY2UgbW9ua2V5cGF0Y2hpbmdcblxuY29uc3QgUGFyc2VyID0gaG9va0JhYnlsb24oYmFieWxvbilcbmNvbnN0IGJhc2VQcm90byA9IFBhcnNlci5wcm90b3R5cGVcbmNvbnN0IHBwID0gUGFyc2VyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoYmFzZVByb3RvKVxuY29uc3QgdHQgPSBiYWJ5bG9uLnRva1R5cGVzXG5cbmNvbnN0IGF0X29mZnNpZGUgPSBvZmZzaWRlT3BlcmF0b3JzRm9yQmFieWxvbih0dClcblxudmFyIF9nX29mZnNpZGVQbHVnaW5PcHRzXG5cbmNvbnN0IF9iYXNlX21vZHVsZV9wYXJzZSA9IGJhYnlsb24ucGFyc2VcbmJhYnlsb24ucGFyc2UgPSAoaW5wdXQsIG9wdGlvbnMpID0+IDo6XG4gIF9nX29mZnNpZGVQbHVnaW5PcHRzID0gb3B0aW9ucyA/IG9wdGlvbnMub2Zmc2lkZVBsdWdpbk9wdHMgOiB1bmRlZmluZWRcbiAgcmV0dXJuIF9iYXNlX21vZHVsZV9wYXJzZShpbnB1dCwgb3B0aW9ucylcblxuXG5wcC5fYmFzZV9wYXJzZSA9IGJhc2VQcm90by5wYXJzZVxucHAucGFyc2UgPSBmdW5jdGlvbigpIDo6XG4gIHRoaXMuaW5pdE9mZnNpZGUoKVxuICByZXR1cm4gdGhpcy5fYmFzZV9wYXJzZSgpXG5cblxuY2xhc3MgT2Zmc2lkZUJyZWFrb3V0IGV4dGVuZHMgRXJyb3Ige31cbmNvbnN0IG9mZnNpZGVCcmVha291dCA9IG5ldyBPZmZzaWRlQnJlYWtvdXQoKVxuXG5wcC5pbml0T2Zmc2lkZSA9IGZ1bmN0aW9uKCkgOjpcbiAgdGhpcy5zdGF0ZS5vZmZzaWRlID0gW11cbiAgdGhpcy5zdGF0ZS5vZmZzaWRlTmV4dE9wID0gbnVsbFxuICB0aGlzLnN0YXRlLm9mZnNpZGVUb2tlblN0YWNrID0gW11cbiAgdGhpcy5vZmZzaWRlX2xpbmVzID0gcGFyc2VPZmZzaWRlSW5kZXhNYXAodGhpcy5pbnB1dClcbiAgdGhpcy5vZmZzaWRlUGx1Z2luT3B0cyA9IF9nX29mZnNpZGVQbHVnaW5PcHRzIHx8IHt9XG4gIF9nX29mZnNpZGVQbHVnaW5PcHRzID0gbnVsbFxuXG4gIHRoaXMuc3RhdGUuX3BvcyA9IHRoaXMuc3RhdGUucG9zXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIHRoaXMuc3RhdGUsICdwb3MnLCBAe31cbiAgICBlbnVtZXJhYmxlOiB0cnVlXG4gICAgZ2V0KCkgOjogcmV0dXJuIHRoaXMuX3Bvc1xuICAgIHNldChwb3MpIDo6XG4gICAgICAvLyBpbnRlcnJ1cHQgc2tpcFNwYWNlIGFsZ29yaXRobSB3aGVuIHdlIGhpdCBvdXIgcG9zaXRpb24gJ2JyZWFrcG9pbnQnXG4gICAgICBjb25zdCBvZmZQb3MgPSB0aGlzLm9mZnNpZGVQb3NcbiAgICAgIGlmIG9mZlBvcz49MCAmJiAocG9zID4gb2ZmUG9zKSA6OlxuICAgICAgICB0aHJvdyBvZmZzaWRlQnJlYWtvdXRcblxuICAgICAgdGhpcy5fcG9zID0gcG9zXG5cblxuY29uc3QgdHRfb2Zmc2lkZV9rZXl3b3JkX3dpdGhfYXJncyA9IG5ldyBTZXQgQCNcbiAgICAgIHR0Ll9pZiwgdHQuX3doaWxlLCB0dC5fZm9yXG4gICAgICB0dC5fY2F0Y2gsIHR0Ll9zd2l0Y2hcblxuY29uc3QgdHRfb2Zmc2lkZV9rZXl3b3JkX2xvb2thaGVhZF9za2lwID0gbmV3IFNldCBAI1xuICAgICAgdHQucGFyZW5MLCB0dC5jb2xvbiwgdHQuY29tbWEsIHR0LmRvdFxuXG5wcC5pc0ZvckF3YWl0ID0gZnVuY3Rpb24gKGtleXdvcmRUeXBlLCB0eXBlLCB2YWwpIDo6XG4gIHJldHVybiB0dC5fZm9yID09PSBrZXl3b3JkVHlwZVxuICAgICYmIHR0Lm5hbWUgPT09IHR5cGVcbiAgICAmJiAnYXdhaXQnID09PSB2YWxcblxuY29uc3Qgcnhfb2Zmc2lkZV9vcCA9IC8oXFxTKylbIFxcdF0qKFxcclxcbnxcXHJ8XFxuKT8vXG5cbnBwLmZpbmlzaFRva2VuU3RhY2sgPSBmdW5jdGlvbih0b2tlbk9yTGlzdCkgOjpcbiAgaWYgQXJyYXkuaXNBcnJheSh0b2tlbk9yTGlzdCkgOjpcbiAgICB0aGlzLnN0YXRlLm9mZnNpZGVUb2tlblN0YWNrID0gdG9rZW5Pckxpc3Quc2xpY2UoMSlcbiAgICB0b2tlbk9yTGlzdCA9IHRva2VuT3JMaXN0WzBdXG5cbiAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4odG9rZW5Pckxpc3QpXG5cbnBwLl9iYXNlX2ZpbmlzaFRva2VuID0gYmFzZVByb3RvLmZpbmlzaFRva2VuXG5wcC5maW5pc2hUb2tlbiA9IGZ1bmN0aW9uKHR5cGUsIHZhbCkgOjpcbiAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0YXRlXG4gIGNvbnN0IHJlY2VudEtleXdvcmQgPSBzdGF0ZS5vZmZzaWRlUmVjZW50S2V5d29yZFxuICBjb25zdCBpbkZvckF3YWl0ID0gcmVjZW50S2V5d29yZCA/IHRoaXMuaXNGb3JBd2FpdChyZWNlbnRLZXl3b3JkLCB0eXBlLCB2YWwpIDogbnVsbFxuICBzdGF0ZS5vZmZzaWRlUmVjZW50S2V5d29yZCA9IG51bGxcblxuICBpZiB0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzLmhhcyh0eXBlKSB8fCBpbkZvckF3YWl0IDo6XG4gICAgY29uc3QgaXNLZXl3b3JkQWxsb3dlZCA9ICF0aGlzLmlzTG9va2FoZWFkXG4gICAgICAmJiB0dC5kb3QgIT09IHN0YXRlLnR5cGVcblxuICAgIGlmICFpc0tleXdvcmRBbGxvd2VkIDo6XG4gICAgICByZXR1cm4gdGhpcy5fYmFzZV9maW5pc2hUb2tlbih0eXBlLCB2YWwpXG5cbiAgICBzdGF0ZS5vZmZzaWRlUmVjZW50S2V5d29yZCA9IGluRm9yQXdhaXQgPyB0dC5fZm9yIDogdHlwZVxuICAgIGNvbnN0IGxvb2thaGVhZCA9IHRoaXMubG9va2FoZWFkKClcblxuICAgIGlmIHR0X29mZnNpZGVfa2V5d29yZF9sb29rYWhlYWRfc2tpcC5oYXMobG9va2FoZWFkLnR5cGUpIDo6XG4gICAgZWxzZSBpZiB0aGlzLmlzRm9yQXdhaXQodHlwZSwgbG9va2FoZWFkLnR5cGUsIGxvb2thaGVhZC52YWx1ZSkgOjpcbiAgICBlbHNlIDo6XG4gICAgICBzdGF0ZS5vZmZzaWRlTmV4dE9wID0gYXRfb2Zmc2lkZS5rZXl3b3JkX2FyZ3NcblxuICAgIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR5cGUsIHZhbClcblxuICBpZiB0eXBlID09PSB0dC5hdCB8fCB0eXBlID09PSB0dC5kb3VibGVDb2xvbiA6OlxuICAgIGNvbnN0IHBvczAgPSBzdGF0ZS5zdGFydCwgcG9zMSA9IHN0YXRlLnBvcyArIDJcbiAgICBjb25zdCBtX29wID0gcnhfb2Zmc2lkZV9vcC5leGVjIEAgdGhpcy5pbnB1dC5zbGljZShwb3MwKVxuICAgIGNvbnN0IHN0cl9vcCA9IG1fb3BbMV1cbiAgICBjb25zdCBsaW5lRW5kc1dpdGhPcCA9ICEhIG1fb3BbMl1cblxuICAgIGxldCBvcCA9IGF0X29mZnNpZGVbc3RyX29wXVxuICAgIGlmIG9wIDo6XG4gICAgICBpZiBvcC5rZXl3b3JkQmxvY2sgJiYgcmVjZW50S2V5d29yZCAmJiB0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzLmhhcyhyZWNlbnRLZXl3b3JkKSA6OlxuICAgICAgICBvcCA9IGF0X29mZnNpZGUua2V5d29yZF9hcmdzXG5cbiAgICAgIGVsc2UgaWYgbGluZUVuZHNXaXRoT3AgJiYgb3AubmVzdElubmVyOjpcbiAgICAgICAgLy8gYWxsIG9mZnNpZGUgb3BlcmF0b3JzIGF0IHRoZSBlbmQgb2YgYSBsaW5lIGltcGxpY2l0bHkgZG9uJ3QgbmVzdElubmVyXG4gICAgICAgIG9wID0gQHt9IF9fcHJvdG9fXzogb3AsIG5lc3RJbm5lcjogZmFsc2VcblxuICAgICAgdGhpcy5maW5pc2hPZmZzaWRlT3Aob3AsIG9wLmV4dHJhQ2hhcnMpXG5cbiAgICAgIGlmIG9wLm5lc3RPcCA6OlxuICAgICAgICBzdGF0ZS5vZmZzaWRlTmV4dE9wID0gYXRfb2Zmc2lkZVtvcC5uZXN0T3BdXG4gICAgICByZXR1cm5cblxuICBpZiB0dC5lb2YgPT09IHR5cGUgOjpcbiAgICBpZiBzdGF0ZS5vZmZzaWRlLmxlbmd0aCA6OlxuICAgICAgcmV0dXJuIHRoaXMucG9wT2Zmc2lkZSgpXG5cbiAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4odHlwZSwgdmFsKVxuXG5cbnBwLm9mZnNpZGVJbmRlbnQgPSBmdW5jdGlvbiAobGluZTAsIG91dGVySW5kZW50LCBpbm5lckluZGVudCkgOjpcbiAgY29uc3Qgb2Zmc2lkZV9saW5lcyA9IHRoaXMub2Zmc2lkZV9saW5lc1xuXG4gIGlmIG51bGwgPT0gaW5uZXJJbmRlbnQgOjpcbiAgICBjb25zdCBpbm5lckxpbmUgPSBvZmZzaWRlX2xpbmVzW2xpbmUwKzFdXG4gICAgaW5uZXJJbmRlbnQgPSBpbm5lckxpbmUgPyBpbm5lckxpbmUuaW5kZW50IDogJydcblxuICBsZXQgbGluZT1saW5lMCsxLCBsYXN0PW9mZnNpZGVfbGluZXNbbGluZTBdXG4gIHdoaWxlIGxpbmUgPCBvZmZzaWRlX2xpbmVzLmxlbmd0aCA6OlxuICAgIGNvbnN0IGN1ciA9IG9mZnNpZGVfbGluZXNbbGluZV1cbiAgICBpZiBjdXIuY29udGVudCAmJiBvdXRlckluZGVudCA+PSBjdXIuaW5kZW50IDo6XG4gICAgICBsaW5lLS0gLy8gYmFja3VwIHRvIHByZXZpb3VzIGxpbmVcbiAgICAgIGJyZWFrXG5cbiAgICBsaW5lKys7IGxhc3QgPSBjdXJcbiAgICBpZiBmYWxzZSA9PT0gaW5uZXJJbmRlbnQgOjpcbiAgICAgIGlubmVySW5kZW50ID0gY3VyLmluZGVudFxuICAgIGVsc2UgaWYgaW5uZXJJbmRlbnQgPiBjdXIuaW5kZW50IDo6XG4gICAgICBpbm5lckluZGVudCA9IGN1ci5pbmRlbnRcblxuICByZXR1cm4gQHt9IGxpbmUsIGxhc3QsIGlubmVySW5kZW50XG5cblxucHAub2Zmc2lkZUJsb2NrID0gZnVuY3Rpb24gKG9wLCBzdGFja1RvcCwgcmVjZW50S2V5d29yZFRvcCkgOjpcbiAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0YXRlXG4gIGNvbnN0IGxpbmUwID0gc3RhdGUuY3VyTGluZVxuICBjb25zdCBmaXJzdCA9IHRoaXMub2Zmc2lkZV9saW5lc1tsaW5lMF1cblxuICBsZXQgaW5kZW50LCBrZXl3b3JkTmVzdGVkSW5kZW50XG4gIGlmIHJlY2VudEtleXdvcmRUb3AgOjpcbiAgICBpbmRlbnQgPSByZWNlbnRLZXl3b3JkVG9wLmZpcnN0LmluZGVudFxuICBlbHNlIGlmIG9wLm5lc3RJbm5lciAmJiBzdGFja1RvcCAmJiBsaW5lMCA9PT0gc3RhY2tUb3AuZmlyc3QubGluZSA6OlxuICAgIGluZGVudCA9IHN0YWNrVG9wLmlubmVySW5kZW50XG4gIGVsc2UgaWYgb3AuaW5LZXl3b3JkQXJnIDo6XG4gICAgaW5kZW50ID0gZmlyc3QuaW5kZW50XG4gICAgY29uc3QgaW5kZW50X2Jsb2NrID0gdGhpcy5vZmZzaWRlSW5kZW50KGxpbmUwLCBpbmRlbnQpXG4gICAgY29uc3QgaW5kZW50X2tleXdvcmQgPSB0aGlzLm9mZnNpZGVJbmRlbnQobGluZTAsIGluZGVudF9ibG9jay5pbm5lckluZGVudClcbiAgICBpZiBpbmRlbnRfa2V5d29yZC5pbm5lckluZGVudCA+IGluZGVudF9ibG9jay5pbm5lckluZGVudCA6OlxuICAgICAgLy8gYXV0b2RldGVjdCBrZXl3b3JkIGFyZ3VtZW50IHVzaW5nICdAJyBmb3IgZnVuY3Rpb24gY2FsbHNcbiAgICAgIGluZGVudCA9IGluZGVudF9ibG9jay5pbm5lckluZGVudFxuICAgICAga2V5d29yZE5lc3RlZEluZGVudCA9IGluZGVudF9rZXl3b3JkLmlubmVySW5kZW50XG4gIGVsc2UgOjpcbiAgICBpbmRlbnQgPSBmaXJzdC5pbmRlbnRcblxuICBsZXQge2xhc3QsIGlubmVySW5kZW50fSA9IHRoaXMub2Zmc2lkZUluZGVudChsaW5lMCwgaW5kZW50LCBrZXl3b3JkTmVzdGVkSW5kZW50KVxuXG4gIC8vIGNhcCB0byBcbiAgaW5uZXJJbmRlbnQgPSBmaXJzdC5pbmRlbnQgPiBpbm5lckluZGVudFxuICAgID8gZmlyc3QuaW5kZW50IDogaW5uZXJJbmRlbnRcblxuICBpZiBzdGFja1RvcCAmJiBzdGFja1RvcC5sYXN0LnBvc0xhc3RDb250ZW50IDwgbGFzdC5wb3NMYXN0Q29udGVudDo6XG4gICAgLy8gRml4dXAgZW5jbG9zaW5nIHNjb3Blcy4gSGFwcGVucyBpbiBzaXR1YXRpb25zIGxpa2U6IGBzZXJ2ZXIub24gQCB3cmFwZXIgQCAoLi4uYXJncykgPT4gOjpgXG4gICAgY29uc3Qgc3RhY2sgPSBzdGF0ZS5vZmZzaWRlXG4gICAgZm9yIGxldCBpZHggPSBzdGFjay5sZW5ndGgtMTsgaWR4PjA7IGlkeC0tIDo6XG4gICAgICBsZXQgdGlwID0gc3RhY2tbaWR4XVxuICAgICAgaWYgdGlwLmxhc3QucG9zTGFzdENvbnRlbnQgPj0gbGFzdC5wb3NMYXN0Q29udGVudCA6OiBicmVha1xuICAgICAgdGlwLmxhc3QgPSBsYXN0XG5cbiAgcmV0dXJuIEB7fSBvcCwgaW5uZXJJbmRlbnQsIGZpcnN0LCBsYXN0XG4gICAgICBzdGFydDogc3RhdGUuc3RhcnQsIGVuZDogc3RhdGUuZW5kXG4gICAgICBsb2M6IEB7fSBzdGFydDogc3RhdGUuc3RhcnRMb2MsIGVuZDogc3RhdGUuZW5kTG9jXG5cblxuXG5wcC5maW5pc2hPZmZzaWRlT3AgPSBmdW5jdGlvbiAob3AsIGV4dHJhQ2hhcnMpIDo6XG4gIGNvbnN0IHN0YWNrID0gdGhpcy5zdGF0ZS5vZmZzaWRlXG4gIGxldCBzdGFja1RvcCA9IHN0YWNrW3N0YWNrLmxlbmd0aCAtIDFdXG4gIGxldCByZWNlbnRLZXl3b3JkVG9wXG4gIGlmIG9wLmNvZGVCbG9jayA6OlxuICAgIGlmIHN0YWNrVG9wICYmIHN0YWNrVG9wLmluS2V5d29yZEFyZyA6OlxuICAgICAgLy8gV2UncmUgYXQgdGhlIGVuZCBvZiBhbiBvZmZzaWRlIGtleXdvcmQgYmxvY2s7IHJlc3RvcmUgZW5jbG9zaW5nICgpXG4gICAgICB0aGlzLnBvcE9mZnNpZGUoKVxuICAgICAgdGhpcy5zdGF0ZS5vZmZzaWRlTmV4dE9wID0gb3BcbiAgICAgIHRoaXMuc3RhdGUub2Zmc2lkZVJlY2VudFRvcCA9IHN0YWNrVG9wXG4gICAgICByZXR1cm5cblxuICAgIHJlY2VudEtleXdvcmRUb3AgPSB0aGlzLnN0YXRlLm9mZnNpZGVSZWNlbnRUb3BcbiAgICB0aGlzLnN0YXRlLm9mZnNpZGVSZWNlbnRUb3AgPSBudWxsXG5cbiAgaWYgZXh0cmFDaGFycyA6OlxuICAgIHRoaXMuc3RhdGUucG9zICs9IGV4dHJhQ2hhcnNcblxuICB0aGlzLmZpbmlzaFRva2VuU3RhY2sob3AudG9rZW5QcmUpXG5cbiAgaWYgdGhpcy5pc0xvb2thaGVhZCA6OiByZXR1cm5cblxuICBzdGFja1RvcCA9IHN0YWNrW3N0YWNrLmxlbmd0aCAtIDFdXG4gIGNvbnN0IGJsayA9IHRoaXMub2Zmc2lkZUJsb2NrKG9wLCBzdGFja1RvcCwgcmVjZW50S2V5d29yZFRvcClcbiAgYmxrLmluS2V5d29yZEFyZyA9IG9wLmluS2V5d29yZEFyZyB8fCBzdGFja1RvcCAmJiBzdGFja1RvcC5pbktleXdvcmRBcmdcbiAgdGhpcy5zdGF0ZS5vZmZzaWRlLnB1c2goYmxrKVxuXG5cbnBwLl9iYXNlX3NraXBTcGFjZSA9IGJhc2VQcm90by5za2lwU3BhY2VcbnBwLnNraXBTcGFjZSA9IGZ1bmN0aW9uKCkgOjpcbiAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0YXRlXG4gIGlmIG51bGwgIT09IHN0YXRlLm9mZnNpZGVOZXh0T3AgOjogcmV0dXJuXG5cbiAgY29uc3Qgc3RhY2sgPSBzdGF0ZS5vZmZzaWRlXG4gIGxldCBzdGFja1RvcFxuICBpZiBzdGFjayAmJiBzdGFjay5sZW5ndGggOjpcbiAgICBzdGFja1RvcCA9IHN0YWNrW3N0YWNrLmxlbmd0aC0xXVxuICAgIHN0YXRlLm9mZnNpZGVQb3MgPSBzdGFja1RvcC5sYXN0LnBvc0xhc3RDb250ZW50XG4gIGVsc2UgOjogc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG5cbiAgdHJ5IDo6XG4gICAgdGhpcy5fYmFzZV9za2lwU3BhY2UoKVxuICAgIHN0YXRlLm9mZnNpZGVQb3MgPSAtMVxuXG4gICAgc3RhdGUub2Zmc2lkZUltcGxpY2l0Q29tbWEgPSB1bmRlZmluZWQgIT09IHN0YWNrVG9wXG4gICAgICA/IHRoaXMub2Zmc2lkZUNoZWNrSW1wbGljaXRDb21tYShzdGFja1RvcClcbiAgICAgIDogbnVsbFxuICBjYXRjaCBlcnIgOjpcbiAgICBpZiBlcnIgIT09IG9mZnNpZGVCcmVha291dCA6OiB0aHJvdyBlcnJcblxuXG5jb25zdCB0dF9vZmZzaWRlX2Rpc3J1cHRfaW1wbGljaXRfY29tbWEgPSBuZXcgU2V0IEAjXG4gIHR0LmNvbW1hLCB0dC5kb3QsIHR0LmFycm93LCB0dC5jb2xvbiwgdHQuc2VtaSwgdHQucXVlc3Rpb25cblxucHAub2Zmc2lkZUNoZWNrSW1wbGljaXRDb21tYSA9IGZ1bmN0aW9uKHN0YWNrVG9wKSA6OlxuICBjb25zdCB7aW1wbGljaXRDb21tYXN9ID0gc3RhY2tUb3Aub3BcbiAgaWYgISBpbXBsaWNpdENvbW1hcyA6OlxuICAgIHJldHVybiBudWxsIC8vIG5vdCBlbmFibGVkIGZvciB0aGlzIG9mZnNpZGUgb3BcbiAgaWYgISB0aGlzLm9mZnNpZGVQbHVnaW5PcHRzLmltcGxpY2l0X2NvbW1hcyA6OlxuICAgIHJldHVybiBudWxsIC8vIG5vdCBlbmFibGVkIGZvciB0aGlzIG9mZnNpZGUgb3BcblxuICBjb25zdCBzdGF0ZSA9IHRoaXMuc3RhdGUsIHN0YXRlX3R5cGU9c3RhdGUudHlwZSwgY29sdW1uID0gc3RhdGUucG9zIC0gc3RhdGUubGluZVN0YXJ0XG4gIGlmIGNvbHVtbiAhPT0gc3RhY2tUb3AuaW5uZXJJbmRlbnQubGVuZ3RoIDo6XG4gICAgcmV0dXJuIG51bGwgLy8gbm90IGF0IHRoZSBleGFjdCByaWdodCBpbmRlbnRcbiAgaWYgc3RhY2tUb3AuZW5kID49IHN0YXRlLmVuZCA6OlxuICAgIHJldHVybiBmYWxzZSAvLyBubyBjb21tYSBiZWZvcmUgdGhlIGZpcnN0IGVsZW1lbnRcbiAgaWYgdHQuY29tbWEgPT09IHN0YXRlX3R5cGUgOjpcbiAgICByZXR1cm4gZmFsc2UgLy8gdGhlcmUncyBhbiBleHBsaWNpdCBjb21tYSBhbHJlYWR5IHByZXNlbnRcbiAgaWYgc3RhdGVfdHlwZS5iaW5vcCB8fCBzdGF0ZV90eXBlLmJlZm9yZUV4cHIgOjpcbiAgICByZXR1cm4gZmFsc2UgLy8gdGhlcmUncyBhbiBvcGVyYXRvciBvciBhcnJvdyBmdW5jdGlvbiBwcmVjZWVkaW5nIHRoaXMgbGluZVxuXG4gIGlmIHRoaXMuaXNMb29rYWhlYWQgOjogcmV0dXJuIGZhbHNlIC8vIGRpc2FsbG93IHJlY3Vyc2l2ZSBsb29rYWhlYWRcbiAgY29uc3Qge3R5cGU6IG5leHRfdHlwZX0gPSB0aGlzLmxvb2thaGVhZCgpXG5cbiAgaWYgdHRfb2Zmc2lkZV9kaXNydXB0X2ltcGxpY2l0X2NvbW1hLmhhcyhuZXh0X3R5cGUpIDo6XG4gICAgcmV0dXJuIGZhbHNlIC8vIHRoZXJlJ3MgYSBjb21tYSwgZG90LCBvciBmdW5jdGlvbiBhcnJvdyB0b2tlbiB0aGF0IHByZWNsdWRlcyBhbiBpbXBsaWNpdCBsZWFkaW5nIGNvbW1hXG4gIGlmIG5leHRfdHlwZS5iaW5vcCA6OlxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpbXBsaWNpdENvbW1hcy5oYXMgOjpcbiAgICAgIC8vIGFsbG93IGZvciB0dC5zdGFyIGluIGNlcnRhaW4gY29udGV4dHMg4oCUIGUuZy4gZm9yIGdlbmVyYXRvciBtZXRob2QgZGVmaW50aW9uc1xuICAgICAgcmV0dXJuIGltcGxpY2l0Q29tbWFzLmhhcyhuZXh0X3R5cGUpXG5cbiAgICByZXR1cm4gZmFsc2UgLy8gdGhlcmUncyBhIGJpbmFyeSBvcGVyYXRvciB0aGF0IHByZWNsdWRlcyBhbiBpbXBsaWNpdCBsZWFkaW5nIGNvbW1hXG4gIGVsc2UgOjpcbiAgICByZXR1cm4gdHJ1ZSAvLyBhbiBpbXBsaWNpdCBjb21tYSBpcyBuZWVkZWRcblxucHAuX2Jhc2VfcmVhZFRva2VuID0gYmFzZVByb3RvLnJlYWRUb2tlblxucHAucmVhZFRva2VuID0gZnVuY3Rpb24oY29kZSkgOjpcbiAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0YXRlXG5cbiAgaWYgc3RhdGUub2Zmc2lkZVRva2VuU3RhY2subGVuZ3RoIDo6XG4gICAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4gQFxuICAgICAgc3RhdGUub2Zmc2lkZVRva2VuU3RhY2suc2hpZnQoKVxuICBpZiBzdGF0ZS5vZmZzaWRlSW1wbGljaXRDb21tYSA6OlxuICAgIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR0LmNvbW1hKVxuXG4gIGNvbnN0IG9mZnNpZGVOZXh0T3AgPSBzdGF0ZS5vZmZzaWRlTmV4dE9wXG4gIGlmIG51bGwgIT09IG9mZnNpZGVOZXh0T3AgOjpcbiAgICBzdGF0ZS5vZmZzaWRlTmV4dE9wID0gbnVsbFxuICAgIHJldHVybiB0aGlzLmZpbmlzaE9mZnNpZGVPcChvZmZzaWRlTmV4dE9wKVxuXG4gIGlmIHN0YXRlLnBvcyA9PT0gc3RhdGUub2Zmc2lkZVBvcyA6OlxuICAgIHJldHVybiB0aGlzLnBvcE9mZnNpZGUoKVxuXG4gIHJldHVybiB0aGlzLl9iYXNlX3JlYWRUb2tlbihjb2RlKVxuXG5wcC5wb3BPZmZzaWRlID0gZnVuY3Rpb24oKSA6OlxuICBjb25zdCBzdGFjayA9IHRoaXMuc3RhdGUub2Zmc2lkZVxuICBjb25zdCBzdGFja1RvcCA9IHRoaXMuaXNMb29rYWhlYWRcbiAgICA/IHN0YWNrW3N0YWNrLmxlbmd0aC0xXVxuICAgIDogc3RhY2sucG9wKClcbiAgdGhpcy5zdGF0ZS5vZmZzaWRlUG9zID0gLTFcblxuICB0aGlzLmZpbmlzaFRva2VuU3RhY2soc3RhY2tUb3Aub3AudG9rZW5Qb3N0KVxuICByZXR1cm4gc3RhY2tUb3BcblxuXG5yZXR1cm4gUGFyc2VyXG59IC8vIGVuZCBwZXItYmFieWxvbiBpbnN0YW5jZSBtb25rZXlwYXRjaGluZ1xuIl19