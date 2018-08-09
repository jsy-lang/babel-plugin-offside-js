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
      const pos0 = state.start;
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
      const head = state.offsideTokenStack.shift();
      if ('string' === typeof head) {
        return this._base_finishToken(tt.name, head);
      } else return this._base_finishToken(head);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL2NvZGUvcGFyc2VyLmpzIl0sIm5hbWVzIjpbImhvb2tCYWJ5bG9uIiwiaW5zdGFsbE9mZnNpZGVCYWJ5bG9uUGFyc2VycyIsImFzT2Zmc2lkZUpTQmFieWxvblBhcnNlciIsImJhYnlsb24iLCJQYXJzZXIiLCJ0Z3RfcGF0Y2giLCJ0b2tUeXBlcyIsImJyYWNlTCIsImZuX3VwZGF0ZUNvbnRleHQiLCJ1cGRhdGVDb250ZXh0IiwicHJldlR5cGUiLCJjb25zdHJ1Y3RvciIsInBhcnNlIiwiRXJyb3IiLCJob29rTGlzdCIsInB1c2giLCJyZXF1aXJlIiwiZXJyIiwibGVuZ3RoIiwibWFwIiwiYmFzZVByb3RvIiwicHJvdG90eXBlIiwicHAiLCJPYmplY3QiLCJjcmVhdGUiLCJ0dCIsImF0X29mZnNpZGUiLCJfZ19vZmZzaWRlUGx1Z2luT3B0cyIsIl9iYXNlX21vZHVsZV9wYXJzZSIsImlucHV0Iiwib3B0aW9ucyIsIm9mZnNpZGVQbHVnaW5PcHRzIiwidW5kZWZpbmVkIiwiX2Jhc2VfcGFyc2UiLCJpbml0T2Zmc2lkZSIsIk9mZnNpZGVCcmVha291dCIsIm9mZnNpZGVCcmVha291dCIsInN0YXRlIiwib2Zmc2lkZSIsIm9mZnNpZGVOZXh0T3AiLCJvZmZzaWRlVG9rZW5TdGFjayIsIm9mZnNpZGVfbGluZXMiLCJfcG9zIiwicG9zIiwiZGVmaW5lUHJvcGVydHkiLCJlbnVtZXJhYmxlIiwiZ2V0Iiwic2V0Iiwib2ZmUG9zIiwib2Zmc2lkZVBvcyIsInR0X29mZnNpZGVfa2V5d29yZF93aXRoX2FyZ3MiLCJTZXQiLCJfaWYiLCJfd2hpbGUiLCJfZm9yIiwiX2NhdGNoIiwiX3N3aXRjaCIsInR0X29mZnNpZGVfa2V5d29yZF9sb29rYWhlYWRfc2tpcCIsInBhcmVuTCIsImNvbG9uIiwiY29tbWEiLCJkb3QiLCJpc0ZvckF3YWl0Iiwia2V5d29yZFR5cGUiLCJ0eXBlIiwidmFsIiwibmFtZSIsInJ4X29mZnNpZGVfb3AiLCJmaW5pc2hUb2tlblN0YWNrIiwidG9rZW5Pckxpc3QiLCJBcnJheSIsImlzQXJyYXkiLCJzbGljZSIsIl9iYXNlX2ZpbmlzaFRva2VuIiwiZmluaXNoVG9rZW4iLCJyZWNlbnRLZXl3b3JkIiwib2Zmc2lkZVJlY2VudEtleXdvcmQiLCJpbkZvckF3YWl0IiwiaGFzIiwiaXNLZXl3b3JkQWxsb3dlZCIsImlzTG9va2FoZWFkIiwibG9va2FoZWFkIiwidmFsdWUiLCJrZXl3b3JkX2FyZ3MiLCJhdCIsImRvdWJsZUNvbG9uIiwicG9zMCIsInN0YXJ0IiwibV9vcCIsImV4ZWMiLCJzdHJfb3AiLCJsaW5lRW5kc1dpdGhPcCIsIm9wIiwia2V5d29yZEJsb2NrIiwibmVzdElubmVyIiwiX19wcm90b19fIiwiZmluaXNoT2Zmc2lkZU9wIiwiZXh0cmFDaGFycyIsIm5lc3RPcCIsImVvZiIsInBvcE9mZnNpZGUiLCJvZmZzaWRlSW5kZW50IiwibGluZTAiLCJvdXRlckluZGVudCIsImlubmVySW5kZW50IiwiaW5uZXJMaW5lIiwiaW5kZW50IiwibGluZSIsImxhc3QiLCJjdXIiLCJjb250ZW50Iiwib2Zmc2lkZUJsb2NrIiwic3RhY2tUb3AiLCJyZWNlbnRLZXl3b3JkVG9wIiwiY3VyTGluZSIsImZpcnN0Iiwia2V5d29yZE5lc3RlZEluZGVudCIsImluS2V5d29yZEFyZyIsImluZGVudF9ibG9jayIsImluZGVudF9rZXl3b3JkIiwicG9zTGFzdENvbnRlbnQiLCJzdGFjayIsImlkeCIsInRpcCIsImVuZCIsImxvYyIsInN0YXJ0TG9jIiwiZW5kTG9jIiwiY29kZUJsb2NrIiwib2Zmc2lkZVJlY2VudFRvcCIsInRva2VuUHJlIiwiYmxrIiwiX2Jhc2Vfc2tpcFNwYWNlIiwic2tpcFNwYWNlIiwib2Zmc2lkZUltcGxpY2l0Q29tbWEiLCJvZmZzaWRlQ2hlY2tJbXBsaWNpdENvbW1hIiwidHRfb2Zmc2lkZV9kaXNydXB0X2ltcGxpY2l0X2NvbW1hIiwiYXJyb3ciLCJzZW1pIiwicXVlc3Rpb24iLCJpbXBsaWNpdENvbW1hcyIsImltcGxpY2l0X2NvbW1hcyIsInN0YXRlX3R5cGUiLCJjb2x1bW4iLCJsaW5lU3RhcnQiLCJiaW5vcCIsImJlZm9yZUV4cHIiLCJuZXh0X3R5cGUiLCJfYmFzZV9yZWFkVG9rZW4iLCJyZWFkVG9rZW4iLCJjb2RlIiwiaGVhZCIsInNoaWZ0IiwicG9wIiwidG9rZW5Qb3N0Il0sIm1hcHBpbmdzIjoiOzs7OztRQUVnQkEsVyxHQUFBQSxXO1FBaUJBQyw0QixHQUFBQSw0QjtRQXNCQUMsd0IsR0FBQUEsd0I7O0FBekNoQjs7QUFFTyxTQUFTRixXQUFULENBQXFCRyxPQUFyQixFQUE4QjtBQUNuQztBQUNBOztBQUVBLE1BQUlDLE1BQUo7QUFDQSxRQUFNQyxZQUFZRixRQUFRRyxRQUFSLENBQWlCQyxNQUFuQztBQUNBLFFBQU1DLG1CQUFtQkgsVUFBVUksYUFBbkM7QUFDQUosWUFBVUksYUFBVixHQUEwQixVQUFVQyxRQUFWLEVBQW9CO0FBQzVDTCxjQUFVSSxhQUFWLEdBQTBCRCxnQkFBMUI7QUFDQUosYUFBUyxLQUFLTyxXQUFkO0FBQXlCLEdBRjNCOztBQUlBUixVQUFRUyxLQUFSLENBQWMsSUFBZDtBQUNBLE1BQUcsQ0FBRVIsTUFBTCxFQUFjO0FBQ1osVUFBTSxJQUFJUyxLQUFKLENBQVksK0JBQVosQ0FBTjtBQUFpRDtBQUNuRCxTQUFPVCxNQUFQO0FBQWEsQ0FHUixTQUFTSCw0QkFBVCxHQUF3QztBQUM3QyxRQUFNYSxXQUFXLEVBQWpCOztBQUVBLE1BQUk7QUFBR0EsYUFBU0MsSUFBVCxDQUNMQyxRQUFRLFNBQVIsQ0FESztBQUNhLEdBRHBCLENBRUEsT0FBTUMsR0FBTixFQUFZOztBQUVaLE1BQUk7QUFBR0gsYUFBU0MsSUFBVCxDQUNMQyxRQUFRLGdDQUFSLENBREs7QUFDb0MsR0FEM0MsQ0FFQSxPQUFNQyxHQUFOLEVBQVk7O0FBRVosTUFBSTtBQUFHSCxhQUFTQyxJQUFULENBQ0xDLFFBQVEsaUNBQVIsQ0FESztBQUNxQyxHQUQ1QyxDQUVBLE9BQU1DLEdBQU4sRUFBWTs7QUFFWixNQUFHLE1BQU1ILFNB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UDtBQUE0QyxPQUQ5QyxNQUVLLE9BQU8sS0FBSzlFLGlCQUFMLENBQXVCOEUsSUFBdkIsQ0FBUDtBQUFtQzs7QUFFMUMsUUFBR2xILE1BQU1pRyxvQkFBVCxFQUFnQztBQUM5QixhQUFPLEtBQUs3RCxpQkFBTCxDQUF1QmhELEdBQUdtQyxLQUExQixDQUFQO0FBQXVDOztBQUV6QyxVQUFNckIsZ0JBQWdCRixNQUFNRSxhQUE1QjtBQUNBLFFBQUcsU0FBU0EsYUFBWixFQUE0QjtBQUMxQkYsWUFBTUUsYUFBTixHQUFzQixJQUF0QjtBQUNBLGFBQU8sS0FBS3lELGVBQUwsQ0FBcUJ6RCxhQUFyQixDQUFQO0FBQTBDOztBQUU1QyxRQUFHRixNQUFNTSxHQUFOLEtBQWNOLE1BQU1ZLFVBQXZCLEVBQW9DO0FBQ2xDLGFBQU8sS0FBS21ELFVBQUwsRUFBUDtBQUF3Qjs7QUFFMUIsV0FBTyxLQUFLZ0QsZUFBTCxDQUFxQkUsSUFBckIsQ0FBUDtBQUFpQyxHQXBCbkM7O0FBc0JBaEksS0FBRzhFLFVBQUgsR0FBZ0IsWUFBVztBQUN6QixVQUFNcUIsUUFBUSxLQUFLcEYsS0FBTCxDQUFXQyxPQUF6QjtBQUNBLFVBQU0wRSxXQUFXLEtBQUtoQyxXQUFMLEdBQ2J5QyxNQUFNQSxNQUFNdkcsTUFBTixHQUFhLENBQW5CLENBRGEsR0FFYnVHLE1BQU1nQyxHQUFOLEVBRko7QUFHQSxTQUFLcEgsS0FBTCxDQUFXWSxVQUFYLEdBQXdCLENBQUMsQ0FBekI7O0FBRUEsU0FBS21CLGdCQUFMLENBQXNCNEMsU0FBU3BCLEVBQVQsQ0FBWThELFNBQWxDO0FBQ0EsV0FBTzFDLFFBQVA7QUFBZSxHQVJqQjs7QUFXQSxTQUFPNUcsTUFBUDtBQUNDLEMsQ0FBQyIsImZpbGUiOiJwYXJzZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge29mZnNpZGVPcGVyYXRvcnNGb3JCYWJ5bG9uLCBwYXJzZU9mZnNpZGVJbmRleE1hcH0gZnJvbSAnLi9vZmZzaWRlX29wcydcblxuZXhwb3J0IGZ1bmN0aW9uIGhvb2tCYWJ5bG9uKGJhYnlsb24pIDo6XG4gIC8vIGFidXNlIEJhYnlsb24gdG9rZW4gdXBkYXRlQ29udGV4dCBjYWxsYmFjayBleHRyYWN0XG4gIC8vIHRoZSByZWZlcmVuY2UgdG8gUGFyc2VyXG5cbiAgbGV0IFBhcnNlclxuICBjb25zdCB0Z3RfcGF0Y2ggPSBiYWJ5bG9uLnRva1R5cGVzLmJyYWNlTFxuICBjb25zdCBmbl91cGRhdGVDb250ZXh0ID0gdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHRcbiAgdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHQgPSBmdW5jdGlvbiAocHJldlR5cGUpIDo6XG4gICAgdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHQgPSBmbl91cGRhdGVDb250ZXh0XG4gICAgUGFyc2VyID0gdGhpcy5jb25zdHJ1Y3RvclxuXG4gIGJhYnlsb24ucGFyc2UoJ3t9JylcbiAgaWYgISBQYXJzZXIgOjpcbiAgICB0aHJvdyBuZXcgRXJyb3IgQCBcIkZhaWxlZCB0byBob29rIEJhYnlsb24gUGFyc2VyXCJcbiAgcmV0dXJuIFBhcnNlclxuXG5cbmV4cG9ydCBmdW5jdGlvbiBpbnN0YWxsT2Zmc2lkZUJhYnlsb25QYXJzZXJzKCkgOjpcbiAgY29uc3QgaG9va0xpc3QgPSBbXVxuXG4gIHRyeSA6OiBob29rTGlzdC5wdXNoIEBcbiAgICByZXF1aXJlKCdiYWJ5bG9uJylcbiAgY2F0Y2ggZXJyIDo6XG5cbiAgdHJ5IDo6IGhvb2tMaXN0LnB1c2ggQFxuICAgIHJlcXVpcmUoJ2JhYmVsLWNsaS9ub2RlX21vZHVsZXMvYmFieWxvbicpXG4gIGNhdGNoIGVyciA6OlxuXG4gIHRyeSA6OiBob29rTGlzdC5wdXNoIEBcbiAgICByZXF1aXJlKCdiYWJlbC1jb3JlL25vZGVfbW9kdWxlcy9iYWJ5bG9uJylcbiAgY2F0Y2ggZXJyIDo6XG5cbiAgaWYgMCA9PT0gaG9va0xpc3QubGVuZ3RoIDo6XG4gICAgdGhyb3cgbmV3IEVycm9yIEAgYFVuYWJsZSB0byBsb2FkIFwiYmFieWxvblwiIHBhcnNlciBwYWNrYWdlYFxuXG4gIHJldHVybiBob29rTGlzdC5tYXAgQCBiYWJ5bG9uID0+XG4gICAgYXNPZmZzaWRlSlNCYWJ5bG9uUGFyc2VyKGJhYnlsb24pXG4gIFxuXG5leHBvcnQgZnVuY3Rpb24gYXNPZmZzaWRlSlNCYWJ5bG9uUGFyc2VyKGJhYnlsb24pXG57IC8vIGJlZ2luIHBlci1iYWJ5bG9uIGluc3RhbmNlIG1vbmtleXBhdGNoaW5nXG5cbmNvbnN0IFBhcnNlciA9IGhvb2tCYWJ5bG9uKGJhYnlsb24pXG5jb25zdCBiYXNlUHJvdG8gPSBQYXJzZXIucHJvdG90eXBlXG5jb25zdCBwcCA9IFBhcnNlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKGJhc2VQcm90bylcbmNvbnN0IHR0ID0gYmFieWxvbi50b2tUeXBlc1xuXG5jb25zdCBhdF9vZmZzaWRlID0gb2Zmc2lkZU9wZXJhdG9yc0ZvckJhYnlsb24odHQpXG5cbnZhciBfZ19vZmZzaWRlUGx1Z2luT3B0c1xuXG5jb25zdCBfYmFzZV9tb2R1bGVfcGFyc2UgPSBiYWJ5bG9uLnBhcnNlXG5iYWJ5bG9uLnBhcnNlID0gKGlucHV0LCBvcHRpb25zKSA9PiA6OlxuICBfZ19vZmZzaWRlUGx1Z2luT3B0cyA9IG9wdGlvbnMgPyBvcHRpb25zLm9mZnNpZGVQbHVnaW5PcHRzIDogdW5kZWZpbmVkXG4gIHJldHVybiBfYmFzZV9tb2R1bGVfcGFyc2UoaW5wdXQsIG9wdGlvbnMpXG5cblxucHAuX2Jhc2VfcGFyc2UgPSBiYXNlUHJvdG8ucGFyc2VcbnBwLnBhcnNlID0gZnVuY3Rpb24oKSA6OlxuICB0aGlzLmluaXRPZmZzaWRlKClcbiAgcmV0dXJuIHRoaXMuX2Jhc2VfcGFyc2UoKVxuXG5cbmNsYXNzIE9mZnNpZGVCcmVha291dCBleHRlbmRzIEVycm9yIHt9XG5jb25zdCBvZmZzaWRlQnJlYWtvdXQgPSBuZXcgT2Zmc2lkZUJyZWFrb3V0KClcblxucHAuaW5pdE9mZnNpZGUgPSBmdW5jdGlvbigpIDo6XG4gIHRoaXMuc3RhdGUub2Zmc2lkZSA9IFtdXG4gIHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCA9IG51bGxcbiAgdGhpcy5zdGF0ZS5vZmZzaWRlVG9rZW5TdGFjayA9IFtdXG4gIHRoaXMub2Zmc2lkZV9saW5lcyA9IHBhcnNlT2Zmc2lkZUluZGV4TWFwKHRoaXMuaW5wdXQpXG4gIHRoaXMub2Zmc2lkZVBsdWdpbk9wdHMgPSBfZ19vZmZzaWRlUGx1Z2luT3B0cyB8fCB7fVxuICBfZ19vZmZzaWRlUGx1Z2luT3B0cyA9IG51bGxcblxuICB0aGlzLnN0YXRlLl9wb3MgPSB0aGlzLnN0YXRlLnBvc1xuICBPYmplY3QuZGVmaW5lUHJvcGVydHkgQCB0aGlzLnN0YXRlLCAncG9zJywgQHt9XG4gICAgZW51bWVyYWJsZTogdHJ1ZVxuICAgIGdldCgpIDo6IHJldHVybiB0aGlzLl9wb3NcbiAgICBzZXQocG9zKSA6OlxuICAgICAgLy8gaW50ZXJydXB0IHNraXBTcGFjZSBhbGdvcml0aG0gd2hlbiB3ZSBoaXQgb3VyIHBvc2l0aW9uICdicmVha3BvaW50J1xuICAgICAgY29uc3Qgb2ZmUG9zID0gdGhpcy5vZmZzaWRlUG9zXG4gICAgICBpZiBvZmZQb3M+PTAgJiYgKHBvcyA+IG9mZlBvcykgOjpcbiAgICAgICAgdGhyb3cgb2Zmc2lkZUJyZWFrb3V0XG5cbiAgICAgIHRoaXMuX3BvcyA9IHBvc1xuXG5cbmNvbnN0IHR0X29mZnNpZGVfa2V5d29yZF93aXRoX2FyZ3MgPSBuZXcgU2V0IEAjXG4gICAgICB0dC5faWYsIHR0Ll93aGlsZSwgdHQuX2ZvclxuICAgICAgdHQuX2NhdGNoLCB0dC5fc3dpdGNoXG5cbmNvbnN0IHR0X29mZnNpZGVfa2V5d29yZF9sb29rYWhlYWRfc2tpcCA9IG5ldyBTZXQgQCNcbiAgICAgIHR0LnBhcmVuTCwgdHQuY29sb24sIHR0LmNvbW1hLCB0dC5kb3RcblxucHAuaXNGb3JBd2FpdCA9IGZ1bmN0aW9uIChrZXl3b3JkVHlwZSwgdHlwZSwgdmFsKSA6OlxuICByZXR1cm4gdHQuX2ZvciA9PT0ga2V5d29yZFR5cGVcbiAgICAmJiB0dC5uYW1lID09PSB0eXBlXG4gICAgJiYgJ2F3YWl0JyA9PT0gdmFsXG5cbmNvbnN0IHJ4X29mZnNpZGVfb3AgPSAvKFxcUyspWyBcXHRdKihcXHJcXG58XFxyfFxcbik/L1xuXG5wcC5maW5pc2hUb2tlblN0YWNrID0gZnVuY3Rpb24odG9rZW5Pckxpc3QpIDo6XG4gIGlmIEFycmF5LmlzQXJyYXkodG9rZW5Pckxpc3QpIDo6XG4gICAgdGhpcy5zdGF0ZS5vZmZzaWRlVG9rZW5TdGFjayA9IHRva2VuT3JMaXN0LnNsaWNlKDEpXG4gICAgdG9rZW5Pckxpc3QgPSB0b2tlbk9yTGlzdFswXVxuXG4gIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHRva2VuT3JMaXN0KVxuXG5wcC5fYmFzZV9maW5pc2hUb2tlbiA9IGJhc2VQcm90by5maW5pc2hUb2tlblxucHAuZmluaXNoVG9rZW4gPSBmdW5jdGlvbih0eXBlLCB2YWwpIDo6XG4gIGNvbnN0IHN0YXRlID0gdGhpcy5zdGF0ZVxuICBjb25zdCByZWNlbnRLZXl3b3JkID0gc3RhdGUub2Zmc2lkZVJlY2VudEtleXdvcmRcbiAgY29uc3QgaW5Gb3JBd2FpdCA9IHJlY2VudEtleXdvcmQgPyB0aGlzLmlzRm9yQXdhaXQocmVjZW50S2V5d29yZCwgdHlwZSwgdmFsKSA6IG51bGxcbiAgc3RhdGUub2Zmc2lkZVJlY2VudEtleXdvcmQgPSBudWxsXG5cbiAgaWYgdHRfb2Zmc2lkZV9rZXl3b3JkX3dpdGhfYXJncy5oYXModHlwZSkgfHwgaW5Gb3JBd2FpdCA6OlxuICAgIGNvbnN0IGlzS2V5d29yZEFsbG93ZWQgPSAhdGhpcy5pc0xvb2thaGVhZFxuICAgICAgJiYgdHQuZG90ICE9PSBzdGF0ZS50eXBlXG5cbiAgICBpZiAhaXNLZXl3b3JkQWxsb3dlZCA6OlxuICAgICAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4odHlwZSwgdmFsKVxuXG4gICAgc3RhdGUub2Zmc2lkZVJlY2VudEtleXdvcmQgPSBpbkZvckF3YWl0ID8gdHQuX2ZvciA6IHR5cGVcbiAgICBjb25zdCBsb29rYWhlYWQgPSB0aGlzLmxvb2thaGVhZCgpXG5cbiAgICBpZiB0dF9vZmZzaWRlX2tleXdvcmRfbG9va2FoZWFkX3NraXAuaGFzKGxvb2thaGVhZC50eXBlKSA6OlxuICAgIGVsc2UgaWYgdGhpcy5pc0ZvckF3YWl0KHR5cGUsIGxvb2thaGVhZC50eXBlLCBsb29rYWhlYWQudmFsdWUpIDo6XG4gICAgZWxzZSA6OlxuICAgICAgc3RhdGUub2Zmc2lkZU5leHRPcCA9IGF0X29mZnNpZGUua2V5d29yZF9hcmdzXG5cbiAgICByZXR1cm4gdGhpcy5fYmFzZV9maW5pc2hUb2tlbih0eXBlLCB2YWwpXG5cbiAgaWYgdHlwZSA9PT0gdHQuYXQgfHwgdHlwZSA9PT0gdHQuZG91YmxlQ29sb24gOjpcbiAgICBjb25zdCBwb3MwID0gc3RhdGUuc3RhcnRcbiAgICBjb25zdCBtX29wID0gcnhfb2Zmc2lkZV9vcC5leGVjIEAgdGhpcy5pbnB1dC5zbGljZShwb3MwKVxuICAgIGNvbnN0IHN0cl9vcCA9IG1fb3BbMV1cbiAgICBjb25zdCBsaW5lRW5kc1dpdGhPcCA9ICEhIG1fb3BbMl1cblxuICAgIGxldCBvcCA9IGF0X29mZnNpZGVbc3RyX29wXVxuICAgIGlmIG9wIDo6XG4gICAgICBpZiBvcC5rZXl3b3JkQmxvY2sgJiYgcmVjZW50S2V5d29yZCAmJiB0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzLmhhcyhyZWNlbnRLZXl3b3JkKSA6OlxuICAgICAgICBvcCA9IGF0X29mZnNpZGUua2V5d29yZF9hcmdzXG5cbiAgICAgIGVsc2UgaWYgbGluZUVuZHNXaXRoT3AgJiYgb3AubmVzdElubmVyOjpcbiAgICAgICAgLy8gYWxsIG9mZnNpZGUgb3BlcmF0b3JzIGF0IHRoZSBlbmQgb2YgYSBsaW5lIGltcGxpY2l0bHkgZG9uJ3QgbmVzdElubmVyXG4gICAgICAgIG9wID0gQHt9IF9fcHJvdG9fXzogb3AsIG5lc3RJbm5lcjogZmFsc2VcblxuICAgICAgdGhpcy5maW5pc2hPZmZzaWRlT3Aob3AsIG9wLmV4dHJhQ2hhcnMpXG5cbiAgICAgIGlmIG9wLm5lc3RPcCA6OlxuICAgICAgICBzdGF0ZS5vZmZzaWRlTmV4dE9wID0gYXRfb2Zmc2lkZVtvcC5uZXN0T3BdXG4gICAgICByZXR1cm5cblxuICBpZiB0dC5lb2YgPT09IHR5cGUgOjpcbiAgICBpZiBzdGF0ZS5vZmZzaWRlLmxlbmd0aCA6OlxuICAgICAgcmV0dXJuIHRoaXMucG9wT2Zmc2lkZSgpXG5cbiAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4odHlwZSwgdmFsKVxuXG5cbnBwLm9mZnNpZGVJbmRlbnQgPSBmdW5jdGlvbiAobGluZTAsIG91dGVySW5kZW50LCBpbm5lckluZGVudCkgOjpcbiAgY29uc3Qgb2Zmc2lkZV9saW5lcyA9IHRoaXMub2Zmc2lkZV9saW5lc1xuXG4gIGlmIG51bGwgPT0gaW5uZXJJbmRlbnQgOjpcbiAgICBjb25zdCBpbm5lckxpbmUgPSBvZmZzaWRlX2xpbmVzW2xpbmUwKzFdXG4gICAgaW5uZXJJbmRlbnQgPSBpbm5lckxpbmUgPyBpbm5lckxpbmUuaW5kZW50IDogJydcblxuICBsZXQgbGluZT1saW5lMCsxLCBsYXN0PW9mZnNpZGVfbGluZXNbbGluZTBdXG4gIHdoaWxlIGxpbmUgPCBvZmZzaWRlX2xpbmVzLmxlbmd0aCA6OlxuICAgIGNvbnN0IGN1ciA9IG9mZnNpZGVfbGluZXNbbGluZV1cbiAgICBpZiBjdXIuY29udGVudCAmJiBvdXRlckluZGVudCA+PSBjdXIuaW5kZW50IDo6XG4gICAgICBsaW5lLS0gLy8gYmFja3VwIHRvIHByZXZpb3VzIGxpbmVcbiAgICAgIGJyZWFrXG5cbiAgICBsaW5lKys7IGxhc3QgPSBjdXJcbiAgICBpZiBmYWxzZSA9PT0gaW5uZXJJbmRlbnQgOjpcbiAgICAgIGlubmVySW5kZW50ID0gY3VyLmluZGVudFxuICAgIGVsc2UgaWYgaW5uZXJJbmRlbnQgPiBjdXIuaW5kZW50IDo6XG4gICAgICBpbm5lckluZGVudCA9IGN1ci5pbmRlbnRcblxuICByZXR1cm4gQHt9IGxpbmUsIGxhc3QsIGlubmVySW5kZW50XG5cblxucHAub2Zmc2lkZUJsb2NrID0gZnVuY3Rpb24gKG9wLCBzdGFja1RvcCwgcmVjZW50S2V5d29yZFRvcCkgOjpcbiAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0YXRlXG4gIGNvbnN0IGxpbmUwID0gc3RhdGUuY3VyTGluZVxuICBjb25zdCBmaXJzdCA9IHRoaXMub2Zmc2lkZV9saW5lc1tsaW5lMF1cblxuICBsZXQgaW5kZW50LCBrZXl3b3JkTmVzdGVkSW5kZW50XG4gIGlmIHJlY2VudEtleXdvcmRUb3AgOjpcbiAgICBpbmRlbnQgPSByZWNlbnRLZXl3b3JkVG9wLmZpcnN0LmluZGVudFxuICBlbHNlIGlmIG9wLm5lc3RJbm5lciAmJiBzdGFja1RvcCAmJiBsaW5lMCA9PT0gc3RhY2tUb3AuZmlyc3QubGluZSA6OlxuICAgIGluZGVudCA9IHN0YWNrVG9wLmlubmVySW5kZW50XG4gIGVsc2UgaWYgb3AuaW5LZXl3b3JkQXJnIDo6XG4gICAgaW5kZW50ID0gZmlyc3QuaW5kZW50XG4gICAgY29uc3QgaW5kZW50X2Jsb2NrID0gdGhpcy5vZmZzaWRlSW5kZW50KGxpbmUwLCBpbmRlbnQpXG4gICAgY29uc3QgaW5kZW50X2tleXdvcmQgPSB0aGlzLm9mZnNpZGVJbmRlbnQobGluZTAsIGluZGVudF9ibG9jay5pbm5lckluZGVudClcbiAgICBpZiBpbmRlbnRfa2V5d29yZC5pbm5lckluZGVudCA+IGluZGVudF9ibG9jay5pbm5lckluZGVudCA6OlxuICAgICAgLy8gYXV0b2RldGVjdCBrZXl3b3JkIGFyZ3VtZW50IHVzaW5nICdAJyBmb3IgZnVuY3Rpb24gY2FsbHNcbiAgICAgIGluZGVudCA9IGluZGVudF9ibG9jay5pbm5lckluZGVudFxuICAgICAga2V5d29yZE5lc3RlZEluZGVudCA9IGluZGVudF9rZXl3b3JkLmlubmVySW5kZW50XG4gIGVsc2UgOjpcbiAgICBpbmRlbnQgPSBmaXJzdC5pbmRlbnRcblxuICBsZXQge2xhc3QsIGlubmVySW5kZW50fSA9IHRoaXMub2Zmc2lkZUluZGVudChsaW5lMCwgaW5kZW50LCBrZXl3b3JkTmVzdGVkSW5kZW50KVxuXG4gIC8vIGNhcCB0byBcbiAgaW5uZXJJbmRlbnQgPSBmaXJzdC5pbmRlbnQgPiBpbm5lckluZGVudFxuICAgID8gZmlyc3QuaW5kZW50IDogaW5uZXJJbmRlbnRcblxuICBpZiBzdGFja1RvcCAmJiBzdGFja1RvcC5sYXN0LnBvc0xhc3RDb250ZW50IDwgbGFzdC5wb3NMYXN0Q29udGVudDo6XG4gICAgLy8gRml4dXAgZW5jbG9zaW5nIHNjb3Blcy4gSGFwcGVucyBpbiBzaXR1YXRpb25zIGxpa2U6IGBzZXJ2ZXIub24gQCB3cmFwZXIgQCAoLi4uYXJncykgPT4gOjpgXG4gICAgY29uc3Qgc3RhY2sgPSBzdGF0ZS5vZmZzaWRlXG4gICAgZm9yIGxldCBpZHggPSBzdGFjay5sZW5ndGgtMTsgaWR4PjA7IGlkeC0tIDo6XG4gICAgICBsZXQgdGlwID0gc3RhY2tbaWR4XVxuICAgICAgaWYgdGlwLmxhc3QucG9zTGFzdENvbnRlbnQgPj0gbGFzdC5wb3NMYXN0Q29udGVudCA6OiBicmVha1xuICAgICAgdGlwLmxhc3QgPSBsYXN0XG5cbiAgcmV0dXJuIEB7fSBvcCwgaW5uZXJJbmRlbnQsIGZpcnN0LCBsYXN0XG4gICAgICBzdGFydDogc3RhdGUuc3RhcnQsIGVuZDogc3RhdGUuZW5kXG4gICAgICBsb2M6IEB7fSBzdGFydDogc3RhdGUuc3RhcnRMb2MsIGVuZDogc3RhdGUuZW5kTG9jXG5cblxuXG5wcC5maW5pc2hPZmZzaWRlT3AgPSBmdW5jdGlvbiAob3AsIGV4dHJhQ2hhcnMpIDo6XG4gIGNvbnN0IHN0YWNrID0gdGhpcy5zdGF0ZS5vZmZzaWRlXG4gIGxldCBzdGFja1RvcCA9IHN0YWNrW3N0YWNrLmxlbmd0aCAtIDFdXG4gIGxldCByZWNlbnRLZXl3b3JkVG9wXG4gIGlmIG9wLmNvZGVCbG9jayA6OlxuICAgIGlmIHN0YWNrVG9wICYmIHN0YWNrVG9wLmluS2V5d29yZEFyZyA6OlxuICAgICAgLy8gV2UncmUgYXQgdGhlIGVuZCBvZiBhbiBvZmZzaWRlIGtleXdvcmQgYmxvY2s7IHJlc3RvcmUgZW5jbG9zaW5nICgpXG4gICAgICB0aGlzLnBvcE9mZnNpZGUoKVxuICAgICAgdGhpcy5zdGF0ZS5vZmZzaWRlTmV4dE9wID0gb3BcbiAgICAgIHRoaXMuc3RhdGUub2Zmc2lkZVJlY2VudFRvcCA9IHN0YWNrVG9wXG4gICAgICByZXR1cm5cblxuICAgIHJlY2VudEtleXdvcmRUb3AgPSB0aGlzLnN0YXRlLm9mZnNpZGVSZWNlbnRUb3BcbiAgICB0aGlzLnN0YXRlLm9mZnNpZGVSZWNlbnRUb3AgPSBudWxsXG5cbiAgaWYgZXh0cmFDaGFycyA6OlxuICAgIHRoaXMuc3RhdGUucG9zICs9IGV4dHJhQ2hhcnNcblxuICB0aGlzLmZpbmlzaFRva2VuU3RhY2sob3AudG9rZW5QcmUpXG5cbiAgaWYgdGhpcy5pc0xvb2thaGVhZCA6OiByZXR1cm5cblxuICBzdGFja1RvcCA9IHN0YWNrW3N0YWNrLmxlbmd0aCAtIDFdXG4gIGNvbnN0IGJsayA9IHRoaXMub2Zmc2lkZUJsb2NrKG9wLCBzdGFja1RvcCwgcmVjZW50S2V5d29yZFRvcClcbiAgYmxrLmluS2V5d29yZEFyZyA9IG9wLmluS2V5d29yZEFyZyB8fCBzdGFja1RvcCAmJiBzdGFja1RvcC5pbktleXdvcmRBcmdcbiAgdGhpcy5zdGF0ZS5vZmZzaWRlLnB1c2goYmxrKVxuXG5cbnBwLl9iYXNlX3NraXBTcGFjZSA9IGJhc2VQcm90by5za2lwU3BhY2VcbnBwLnNraXBTcGFjZSA9IGZ1bmN0aW9uKCkgOjpcbiAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0YXRlXG4gIGlmIG51bGwgIT09IHN0YXRlLm9mZnNpZGVOZXh0T3AgOjogcmV0dXJuXG5cbiAgY29uc3Qgc3RhY2sgPSBzdGF0ZS5vZmZzaWRlXG4gIGxldCBzdGFja1RvcFxuICBpZiBzdGFjayAmJiBzdGFjay5sZW5ndGggOjpcbiAgICBzdGFja1RvcCA9IHN0YWNrW3N0YWNrLmxlbmd0aC0xXVxuICAgIHN0YXRlLm9mZnNpZGVQb3MgPSBzdGFja1RvcC5sYXN0LnBvc0xhc3RDb250ZW50XG4gIGVsc2UgOjogc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG5cbiAgdHJ5IDo6XG4gICAgdGhpcy5fYmFzZV9za2lwU3BhY2UoKVxuICAgIHN0YXRlLm9mZnNpZGVQb3MgPSAtMVxuXG4gICAgc3RhdGUub2Zmc2lkZUltcGxpY2l0Q29tbWEgPSB1bmRlZmluZWQgIT09IHN0YWNrVG9wXG4gICAgICA/IHRoaXMub2Zmc2lkZUNoZWNrSW1wbGljaXRDb21tYShzdGFja1RvcClcbiAgICAgIDogbnVsbFxuICBjYXRjaCBlcnIgOjpcbiAgICBpZiBlcnIgIT09IG9mZnNpZGVCcmVha291dCA6OiB0aHJvdyBlcnJcblxuXG5jb25zdCB0dF9vZmZzaWRlX2Rpc3J1cHRfaW1wbGljaXRfY29tbWEgPSBuZXcgU2V0IEAjXG4gIHR0LmNvbW1hLCB0dC5kb3QsIHR0LmFycm93LCB0dC5jb2xvbiwgdHQuc2VtaSwgdHQucXVlc3Rpb25cblxucHAub2Zmc2lkZUNoZWNrSW1wbGljaXRDb21tYSA9IGZ1bmN0aW9uKHN0YWNrVG9wKSA6OlxuICBjb25zdCB7aW1wbGljaXRDb21tYXN9ID0gc3RhY2tUb3Aub3BcbiAgaWYgISBpbXBsaWNpdENvbW1hcyA6OlxuICAgIHJldHVybiBudWxsIC8vIG5vdCBlbmFibGVkIGZvciB0aGlzIG9mZnNpZGUgb3BcbiAgaWYgISB0aGlzLm9mZnNpZGVQbHVnaW5PcHRzLmltcGxpY2l0X2NvbW1hcyA6OlxuICAgIHJldHVybiBudWxsIC8vIG5vdCBlbmFibGVkIGZvciB0aGlzIG9mZnNpZGUgb3BcblxuICBjb25zdCBzdGF0ZSA9IHRoaXMuc3RhdGUsIHN0YXRlX3R5cGU9c3RhdGUudHlwZSwgY29sdW1uID0gc3RhdGUucG9zIC0gc3RhdGUubGluZVN0YXJ0XG4gIGlmIGNvbHVtbiAhPT0gc3RhY2tUb3AuaW5uZXJJbmRlbnQubGVuZ3RoIDo6XG4gICAgcmV0dXJuIG51bGwgLy8gbm90IGF0IHRoZSBleGFjdCByaWdodCBpbmRlbnRcbiAgaWYgc3RhY2tUb3AuZW5kID49IHN0YXRlLmVuZCA6OlxuICAgIHJldHVybiBmYWxzZSAvLyBubyBjb21tYSBiZWZvcmUgdGhlIGZpcnN0IGVsZW1lbnRcbiAgaWYgdHQuY29tbWEgPT09IHN0YXRlX3R5cGUgOjpcbiAgICByZXR1cm4gZmFsc2UgLy8gdGhlcmUncyBhbiBleHBsaWNpdCBjb21tYSBhbHJlYWR5IHByZXNlbnRcbiAgaWYgc3RhdGVfdHlwZS5iaW5vcCB8fCBzdGF0ZV90eXBlLmJlZm9yZUV4cHIgOjpcbiAgICByZXR1cm4gZmFsc2UgLy8gdGhlcmUncyBhbiBvcGVyYXRvciBvciBhcnJvdyBmdW5jdGlvbiBwcmVjZWVkaW5nIHRoaXMgbGluZVxuXG4gIGlmIHRoaXMuaXNMb29rYWhlYWQgOjogcmV0dXJuIGZhbHNlIC8vIGRpc2FsbG93IHJlY3Vyc2l2ZSBsb29rYWhlYWRcbiAgY29uc3Qge3R5cGU6IG5leHRfdHlwZX0gPSB0aGlzLmxvb2thaGVhZCgpXG5cbiAgaWYgdHRfb2Zmc2lkZV9kaXNydXB0X2ltcGxpY2l0X2NvbW1hLmhhcyhuZXh0X3R5cGUpIDo6XG4gICAgcmV0dXJuIGZhbHNlIC8vIHRoZXJlJ3MgYSBjb21tYSwgZG90LCBvciBmdW5jdGlvbiBhcnJvdyB0b2tlbiB0aGF0IHByZWNsdWRlcyBhbiBpbXBsaWNpdCBsZWFkaW5nIGNvbW1hXG4gIGlmIG5leHRfdHlwZS5iaW5vcCA6OlxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpbXBsaWNpdENvbW1hcy5oYXMgOjpcbiAgICAgIC8vIGFsbG93IGZvciB0dC5zdGFyIGluIGNlcnRhaW4gY29udGV4dHMg4oCUIGUuZy4gZm9yIGdlbmVyYXRvciBtZXRob2QgZGVmaW50aW9uc1xuICAgICAgcmV0dXJuIGltcGxpY2l0Q29tbWFzLmhhcyhuZXh0X3R5cGUpXG5cbiAgICByZXR1cm4gZmFsc2UgLy8gdGhlcmUncyBhIGJpbmFyeSBvcGVyYXRvciB0aGF0IHByZWNsdWRlcyBhbiBpbXBsaWNpdCBsZWFkaW5nIGNvbW1hXG4gIGVsc2UgOjpcbiAgICByZXR1cm4gdHJ1ZSAvLyBhbiBpbXBsaWNpdCBjb21tYSBpcyBuZWVkZWRcblxucHAuX2Jhc2VfcmVhZFRva2VuID0gYmFzZVByb3RvLnJlYWRUb2tlblxucHAucmVhZFRva2VuID0gZnVuY3Rpb24oY29kZSkgOjpcbiAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0YXRlXG5cbiAgaWYgc3RhdGUub2Zmc2lkZVRva2VuU3RhY2subGVuZ3RoIDo6XG4gICAgY29uc3QgaGVhZCA9IHN0YXRlLm9mZnNpZGVUb2tlblN0YWNrLnNoaWZ0KClcbiAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGhlYWQgOjpcbiAgICAgIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR0Lm5hbWUsIGhlYWQpXG4gICAgZWxzZSByZXR1cm4gdGhpcy5fYmFzZV9maW5pc2hUb2tlbihoZWFkKVxuXG4gIGlmIHN0YXRlLm9mZnNpZGVJbXBsaWNpdENvbW1hIDo6XG4gICAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4odHQuY29tbWEpXG5cbiAgY29uc3Qgb2Zmc2lkZU5leHRPcCA9IHN0YXRlLm9mZnNpZGVOZXh0T3BcbiAgaWYgbnVsbCAhPT0gb2Zmc2lkZU5leHRPcCA6OlxuICAgIHN0YXRlLm9mZnNpZGVOZXh0T3AgPSBudWxsXG4gICAgcmV0dXJuIHRoaXMuZmluaXNoT2Zmc2lkZU9wKG9mZnNpZGVOZXh0T3ApXG5cbiAgaWYgc3RhdGUucG9zID09PSBzdGF0ZS5vZmZzaWRlUG9zIDo6XG4gICAgcmV0dXJuIHRoaXMucG9wT2Zmc2lkZSgpXG5cbiAgcmV0dXJuIHRoaXMuX2Jhc2VfcmVhZFRva2VuKGNvZGUpXG5cbnBwLnBvcE9mZnNpZGUgPSBmdW5jdGlvbigpIDo6XG4gIGNvbnN0IHN0YWNrID0gdGhpcy5zdGF0ZS5vZmZzaWRlXG4gIGNvbnN0IHN0YWNrVG9wID0gdGhpcy5pc0xvb2thaGVhZFxuICAgID8gc3RhY2tbc3RhY2subGVuZ3RoLTFdXG4gICAgOiBzdGFjay5wb3AoKVxuICB0aGlzLnN0YXRlLm9mZnNpZGVQb3MgPSAtMVxuXG4gIHRoaXMuZmluaXNoVG9rZW5TdGFjayhzdGFja1RvcC5vcC50b2tlblBvc3QpXG4gIHJldHVybiBzdGFja1RvcFxuXG5cbnJldHVybiBQYXJzZXJcbn0gLy8gZW5kIHBlci1iYWJ5bG9uIGluc3RhbmNlIG1vbmtleXBhdGNoaW5nXG4iXX0=