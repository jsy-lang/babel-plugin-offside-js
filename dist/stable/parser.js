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
    const res = _inner.call(this, code);
    //console.dir(this, {colors:true})
    return res;

    function _inner(code) {
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
    }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL2NvZGUvcGFyc2VyLmpzIl0sIm5hbWVzIjpbImhvb2tCYWJ5bG9uIiwiaW5zdGFsbE9mZnNpZGVCYWJ5bG9uUGFyc2VycyIsImFzT2Zmc2lkZUpTQmFieWxvblBhcnNlciIsImJhYnlsb24iLCJQYXJzZXIiLCJ0Z3RfcGF0Y2giLCJ0b2tUeXBlcyIsImJyYWNlTCIsImZuX3VwZGF0ZUNvbnRleHQiLCJ1cGRhdGVDb250ZXh0IiwicHJldlR5cGUiLCJjb25zdHJ1Y3RvciIsInBhcnNlIiwiRXJyb3IiLCJob29rTGlzdCIsInB1c2giLCJyZXF1aXJlIiwiZXJyIiwibGVuZ3RoIiwibWFwIiwiYmFzZVByb3RvIiwicHJvdG90eXBlIiwicHAiLCJPYmplY3QiLCJjcmVhdGUiLCJ0dCIsImF0X29mZnNpZGUiLCJfZ19vZmZzaWRlUGx1Z2luT3B0cyIsIl9iYXNlX21vZHVsZV9wYXJzZSIsImlucHV0Iiwib3B0aW9ucyIsIm9mZnNpZGVQbHVnaW5PcHRzIiwidW5kZWZpbmVkIiwiX2Jhc2VfcGFyc2UiLCJpbml0T2Zmc2lkZSIsIk9mZnNpZGVCcmVha291dCIsIm9mZnNpZGVCcmVha291dCIsInN0YXRlIiwib2Zmc2lkZSIsIm9mZnNpZGVOZXh0T3AiLCJvZmZzaWRlVG9rZW5TdGFjayIsIm9mZnNpZGVfbGluZXMiLCJfcG9zIiwicG9zIiwiZGVmaW5lUHJvcGVydHkiLCJlbnVtZXJhYmxlIiwiZ2V0Iiwic2V0Iiwib2ZmUG9zIiwib2Zmc2lkZVBvcyIsInR0X29mZnNpZGVfa2V5d29yZF93aXRoX2FyZ3MiLCJTZXQiLCJfaWYiLCJfd2hpbGUiLCJfZm9yIiwiX2NhdGNoIiwiX3N3aXRjaCIsInR0X29mZnNpZGVfa2V5d29yZF9sb29rYWhlYWRfc2tpcCIsInBhcmVuTCIsImNvbG9uIiwiY29tbWEiLCJkb3QiLCJpc0ZvckF3YWl0Iiwia2V5d29yZFR5cGUiLCJ0eXBlIiwidmFsIiwibmFtZSIsInJ4X29mZnNpZGVfb3AiLCJmaW5pc2hUb2tlblN0YWNrIiwidG9rZW5Pckxpc3QiLCJBcnJheSIsImlzQXJyYXkiLCJzbGljZSIsIl9iYXNlX2ZpbmlzaFRva2VuIiwiZmluaXNoVG9rZW4iLCJyZWNlbnRLZXl3b3JkIiwib2Zmc2lkZVJlY2VudEtleXdvcmQiLCJpbkZvckF3YWl0IiwiaGFzIiwiaXNLZXl3b3JkQWxsb3dlZCIsImlzTG9va2FoZWFkIiwibG9va2FoZWFkIiwidmFsdWUiLCJrZXl3b3JkX2FyZ3MiLCJhdCIsImRvdWJsZUNvbG9uIiwicG9zMCIsInN0YXJ0IiwibV9vcCIsImV4ZWMiLCJzdHJfb3AiLCJsaW5lRW5kc1dpdGhPcCIsIm9wIiwia2V5d29yZEJsb2NrIiwibmVzdElubmVyIiwiX19wcm90b19fIiwiZmluaXNoT2Zmc2lkZU9wIiwiZXh0cmFDaGFycyIsIm5lc3RPcCIsImVvZiIsInBvcE9mZnNpZGUiLCJvZmZzaWRlSW5kZW50IiwibGluZTAiLCJvdXRlckluZGVudCIsImlubmVySW5kZW50IiwiaW5uZXJMaW5lIiwiaW5kZW50IiwibGluZSIsImxhc3QiLCJjdXIiLCJjb250ZW50Iiwib2Zmc2lkZUJsb2NrIiwic3RhY2tUb3AiLCJyZWNlbnRLZXl3b3JkVG9wIiwiY3VyTGluZSIsImZpcnN0Iiwia2V5d29yZE5lc3RlZEluZGVudCIsImluS2V5d29yZEFyZyIsImluZGVudF9ibG9jayIsImluZGVudF9rZXl3b3JkIiwicG9zTGFzdENvbnRlbnQiLCJzdGFjayIsImlkeCIsInRpcCIsImVuZCIsImxvYyIsInN0YXJ0TG9jIiwiZW5kTG9jIiwiY29kZUJsb2NrIiwib2Zmc2lkZVJlY2VudFRvcCIsInRva2VuUHJlIiwiYmxrIiwiX2Jhc2Vfc2tpcFNwYWNlIiwic2tpcFNwYWNlIiwib2Zmc2lkZUltcGxpY2l0Q29tbWEiLCJvZmZzaWRlQ2hlY2tJbXBsaWNpdENvbW1hIiwidHRfb2Zmc2lkZV9kaXNydXB0X2ltcGxpY2l0X2NvbW1hIiwiYXJyb3ciLCJzZW1pIiwicXVlc3Rpb24iLCJpbXBsaWNpdENvbW1hcyIsImltcGxpY2l0X2NvbW1hcyIsInN0YXRlX3R5cGUiLCJjb2x1bW4iLCJsaW5lU3RhcnQiLCJiaW5vcCIsImJlZm9yZUV4cHIiLCJuZXh0X3R5cGUiLCJfYmFzZV9yZWFkVG9rZW4iLCJyZWFkVG9rZW4iLCJjb2RlIiwicmVzIiwiX2lubmVyIiwiY2FsbCIsImhlYWQiLCJzaGlmdCIsInBvcCIsInRva2VuUG9zdCJdLCJtYXBwaW5ncyI6Ijs7Ozs7UUFFZ0JBLFcsR0FBQUEsVztRQWlCQUMsNEIsR0FBQUEsNEI7UUFzQkFDLHdCLEdBQUFBLHdCOztBQXpDaEI7O0FBRU8sU0FBU0YsV0FBVCxDQUFxQkcsT0FBckIsRUFBOEI7QUFDbkM7QUFDQTs7QUFFQSxNQUFJQyxNQUFKO0FBQ0EsUUFBTUMsWUFBWUYsUUFBUUcsUUFBUixDQUFpQkMsTUFBbkM7QUFDQSxRQUFNQyxtQkFBbUJILFVBQVVJLGFBQW5DO0FBQ0FKLFlBQVVJLGFBQVYsR0FBMEIsVUFBVUMsUUFBVixFQUFvQjtBQUM1Q0wsY0FBVUksYUFBVixHQUEwQkQsZ0JBQTFCO0FBQ0FKLGFBQVMsS0FBS08sV0FBZDtBQUF5QixHQUYzQjs7QUFJQVIsVUFBUVMsS0FBUixDQUFjLElBQWQ7QUFDQSxNQUFHLENBQUVSLE1BQUwsRUFBYztBQUNaLFVBQU0sSUFBSVMsS0FBSixDQUFZLCtCQUFaLENBQU47QUFBaUQ7QUFDbkQsU0FBT1QsTUFBUDtBQUFhLENBR1IsU0FBU0gsNEJBQVQsR0FBd0M7QUFDN0MsUUFBTWEsV0FBVyxFQUFqQjs7QUFFQSxNQUFJO0FBQUdBLGFBQVNDLElBQVQsQ0FDTEMsUUFBUSxTQUFSLENBREs7QUFDYSxHQURwQixDQUVBLE9BQU1DLEdBQU4sRUFBWTs7QUFFWixNQUFJO0FBQUdILGFBQVNDLElBQVQsQ0FDTEMsUUFBUSxnQ0FBUixDQURLO0FBQ29DLEdBRDNDLENBRUEsT0FBTUMsR0FBTixFQUFZOztBQUVaLE1BQUk7QUFBR0gsYUFBU0MsSUFBVCxDQUNMQyxRQUFRLGlDQUFSLENBREs7QUFDcUMsR0FENUMsQ0FFQSxPQUFNQyxHQUFOLEVB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cGFyc2VyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtvZmZzaWRlT3BlcmF0b3JzRm9yQmFieWxvbiwgcGFyc2VPZmZzaWRlSW5kZXhNYXB9IGZyb20gJy4vb2Zmc2lkZV9vcHMnXG5cbmV4cG9ydCBmdW5jdGlvbiBob29rQmFieWxvbihiYWJ5bG9uKSA6OlxuICAvLyBhYnVzZSBCYWJ5bG9uIHRva2VuIHVwZGF0ZUNvbnRleHQgY2FsbGJhY2sgZXh0cmFjdFxuICAvLyB0aGUgcmVmZXJlbmNlIHRvIFBhcnNlclxuXG4gIGxldCBQYXJzZXJcbiAgY29uc3QgdGd0X3BhdGNoID0gYmFieWxvbi50b2tUeXBlcy5icmFjZUxcbiAgY29uc3QgZm5fdXBkYXRlQ29udGV4dCA9IHRndF9wYXRjaC51cGRhdGVDb250ZXh0XG4gIHRndF9wYXRjaC51cGRhdGVDb250ZXh0ID0gZnVuY3Rpb24gKHByZXZUeXBlKSA6OlxuICAgIHRndF9wYXRjaC51cGRhdGVDb250ZXh0ID0gZm5fdXBkYXRlQ29udGV4dFxuICAgIFBhcnNlciA9IHRoaXMuY29uc3RydWN0b3JcblxuICBiYWJ5bG9uLnBhcnNlKCd7fScpXG4gIGlmICEgUGFyc2VyIDo6XG4gICAgdGhyb3cgbmV3IEVycm9yIEAgXCJGYWlsZWQgdG8gaG9vayBCYWJ5bG9uIFBhcnNlclwiXG4gIHJldHVybiBQYXJzZXJcblxuXG5leHBvcnQgZnVuY3Rpb24gaW5zdGFsbE9mZnNpZGVCYWJ5bG9uUGFyc2VycygpIDo6XG4gIGNvbnN0IGhvb2tMaXN0ID0gW11cblxuICB0cnkgOjogaG9va0xpc3QucHVzaCBAXG4gICAgcmVxdWlyZSgnYmFieWxvbicpXG4gIGNhdGNoIGVyciA6OlxuXG4gIHRyeSA6OiBob29rTGlzdC5wdXNoIEBcbiAgICByZXF1aXJlKCdiYWJlbC1jbGkvbm9kZV9tb2R1bGVzL2JhYnlsb24nKVxuICBjYXRjaCBlcnIgOjpcblxuICB0cnkgOjogaG9va0xpc3QucHVzaCBAXG4gICAgcmVxdWlyZSgnYmFiZWwtY29yZS9ub2RlX21vZHVsZXMvYmFieWxvbicpXG4gIGNhdGNoIGVyciA6OlxuXG4gIGlmIDAgPT09IGhvb2tMaXN0Lmxlbmd0aCA6OlxuICAgIHRocm93IG5ldyBFcnJvciBAIGBVbmFibGUgdG8gbG9hZCBcImJhYnlsb25cIiBwYXJzZXIgcGFja2FnZWBcblxuICByZXR1cm4gaG9va0xpc3QubWFwIEAgYmFieWxvbiA9PlxuICAgIGFzT2Zmc2lkZUpTQmFieWxvblBhcnNlcihiYWJ5bG9uKVxuICBcblxuZXhwb3J0IGZ1bmN0aW9uIGFzT2Zmc2lkZUpTQmFieWxvblBhcnNlcihiYWJ5bG9uKVxueyAvLyBiZWdpbiBwZXItYmFieWxvbiBpbnN0YW5jZSBtb25rZXlwYXRjaGluZ1xuXG5jb25zdCBQYXJzZXIgPSBob29rQmFieWxvbihiYWJ5bG9uKVxuY29uc3QgYmFzZVByb3RvID0gUGFyc2VyLnByb3RvdHlwZVxuY29uc3QgcHAgPSBQYXJzZXIucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShiYXNlUHJvdG8pXG5jb25zdCB0dCA9IGJhYnlsb24udG9rVHlwZXNcblxuY29uc3QgYXRfb2Zmc2lkZSA9IG9mZnNpZGVPcGVyYXRvcnNGb3JCYWJ5bG9uKHR0KVxuXG52YXIgX2dfb2Zmc2lkZVBsdWdpbk9wdHNcblxuY29uc3QgX2Jhc2VfbW9kdWxlX3BhcnNlID0gYmFieWxvbi5wYXJzZVxuYmFieWxvbi5wYXJzZSA9IChpbnB1dCwgb3B0aW9ucykgPT4gOjpcbiAgX2dfb2Zmc2lkZVBsdWdpbk9wdHMgPSBvcHRpb25zID8gb3B0aW9ucy5vZmZzaWRlUGx1Z2luT3B0cyA6IHVuZGVmaW5lZFxuICByZXR1cm4gX2Jhc2VfbW9kdWxlX3BhcnNlKGlucHV0LCBvcHRpb25zKVxuXG5cbnBwLl9iYXNlX3BhcnNlID0gYmFzZVByb3RvLnBhcnNlXG5wcC5wYXJzZSA9IGZ1bmN0aW9uKCkgOjpcbiAgdGhpcy5pbml0T2Zmc2lkZSgpXG4gIHJldHVybiB0aGlzLl9iYXNlX3BhcnNlKClcblxuXG5jbGFzcyBPZmZzaWRlQnJlYWtvdXQgZXh0ZW5kcyBFcnJvciB7fVxuY29uc3Qgb2Zmc2lkZUJyZWFrb3V0ID0gbmV3IE9mZnNpZGVCcmVha291dCgpXG5cbnBwLmluaXRPZmZzaWRlID0gZnVuY3Rpb24oKSA6OlxuICB0aGlzLnN0YXRlLm9mZnNpZGUgPSBbXVxuICB0aGlzLnN0YXRlLm9mZnNpZGVOZXh0T3AgPSBudWxsXG4gIHRoaXMuc3RhdGUub2Zmc2lkZVRva2VuU3RhY2sgPSBbXVxuICB0aGlzLm9mZnNpZGVfbGluZXMgPSBwYXJzZU9mZnNpZGVJbmRleE1hcCh0aGlzLmlucHV0KVxuICB0aGlzLm9mZnNpZGVQbHVnaW5PcHRzID0gX2dfb2Zmc2lkZVBsdWdpbk9wdHMgfHwge31cbiAgX2dfb2Zmc2lkZVBsdWdpbk9wdHMgPSBudWxsXG5cbiAgdGhpcy5zdGF0ZS5fcG9zID0gdGhpcy5zdGF0ZS5wb3NcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5IEAgdGhpcy5zdGF0ZSwgJ3BvcycsIEB7fVxuICAgIGVudW1lcmFibGU6IHRydWVcbiAgICBnZXQoKSA6OiByZXR1cm4gdGhpcy5fcG9zXG4gICAgc2V0KHBvcykgOjpcbiAgICAgIC8vIGludGVycnVwdCBza2lwU3BhY2UgYWxnb3JpdGhtIHdoZW4gd2UgaGl0IG91ciBwb3NpdGlvbiAnYnJlYWtwb2ludCdcbiAgICAgIGNvbnN0IG9mZlBvcyA9IHRoaXMub2Zmc2lkZVBvc1xuICAgICAgaWYgb2ZmUG9zPj0wICYmIChwb3MgPiBvZmZQb3MpIDo6XG4gICAgICAgIHRocm93IG9mZnNpZGVCcmVha291dFxuXG4gICAgICB0aGlzLl9wb3MgPSBwb3NcblxuXG5jb25zdCB0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzID0gbmV3IFNldCBAI1xuICAgICAgdHQuX2lmLCB0dC5fd2hpbGUsIHR0Ll9mb3JcbiAgICAgIHR0Ll9jYXRjaCwgdHQuX3N3aXRjaFxuXG5jb25zdCB0dF9vZmZzaWRlX2tleXdvcmRfbG9va2FoZWFkX3NraXAgPSBuZXcgU2V0IEAjXG4gICAgICB0dC5wYXJlbkwsIHR0LmNvbG9uLCB0dC5jb21tYSwgdHQuZG90XG5cbnBwLmlzRm9yQXdhaXQgPSBmdW5jdGlvbiAoa2V5d29yZFR5cGUsIHR5cGUsIHZhbCkgOjpcbiAgcmV0dXJuIHR0Ll9mb3IgPT09IGtleXdvcmRUeXBlXG4gICAgJiYgdHQubmFtZSA9PT0gdHlwZVxuICAgICYmICdhd2FpdCcgPT09IHZhbFxuXG5jb25zdCByeF9vZmZzaWRlX29wID0gLyhcXFMrKVsgXFx0XSooXFxyXFxufFxccnxcXG4pPy9cblxucHAuZmluaXNoVG9rZW5TdGFjayA9IGZ1bmN0aW9uKHRva2VuT3JMaXN0KSA6OlxuICBpZiBBcnJheS5pc0FycmF5KHRva2VuT3JMaXN0KSA6OlxuICAgIHRoaXMuc3RhdGUub2Zmc2lkZVRva2VuU3RhY2sgPSB0b2tlbk9yTGlzdC5zbGljZSgxKVxuICAgIHRva2VuT3JMaXN0ID0gdG9rZW5Pckxpc3RbMF1cblxuICByZXR1cm4gdGhpcy5fYmFzZV9maW5pc2hUb2tlbih0b2tlbk9yTGlzdClcblxucHAuX2Jhc2VfZmluaXNoVG9rZW4gPSBiYXNlUHJvdG8uZmluaXNoVG9rZW5cbnBwLmZpbmlzaFRva2VuID0gZnVuY3Rpb24odHlwZSwgdmFsKSA6OlxuICBjb25zdCBzdGF0ZSA9IHRoaXMuc3RhdGVcbiAgY29uc3QgcmVjZW50S2V5d29yZCA9IHN0YXRlLm9mZnNpZGVSZWNlbnRLZXl3b3JkXG4gIGNvbnN0IGluRm9yQXdhaXQgPSByZWNlbnRLZXl3b3JkID8gdGhpcy5pc0ZvckF3YWl0KHJlY2VudEtleXdvcmQsIHR5cGUsIHZhbCkgOiBudWxsXG4gIHN0YXRlLm9mZnNpZGVSZWNlbnRLZXl3b3JkID0gbnVsbFxuXG4gIGlmIHR0X29mZnNpZGVfa2V5d29yZF93aXRoX2FyZ3MuaGFzKHR5cGUpIHx8IGluRm9yQXdhaXQgOjpcbiAgICBjb25zdCBpc0tleXdvcmRBbGxvd2VkID0gIXRoaXMuaXNMb29rYWhlYWRcbiAgICAgICYmIHR0LmRvdCAhPT0gc3RhdGUudHlwZVxuXG4gICAgaWYgIWlzS2V5d29yZEFsbG93ZWQgOjpcbiAgICAgIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR5cGUsIHZhbClcblxuICAgIHN0YXRlLm9mZnNpZGVSZWNlbnRLZXl3b3JkID0gaW5Gb3JBd2FpdCA/IHR0Ll9mb3IgOiB0eXBlXG4gICAgY29uc3QgbG9va2FoZWFkID0gdGhpcy5sb29rYWhlYWQoKVxuXG4gICAgaWYgdHRfb2Zmc2lkZV9rZXl3b3JkX2xvb2thaGVhZF9za2lwLmhhcyhsb29rYWhlYWQudHlwZSkgOjpcbiAgICBlbHNlIGlmIHRoaXMuaXNGb3JBd2FpdCh0eXBlLCBsb29rYWhlYWQudHlwZSwgbG9va2FoZWFkLnZhbHVlKSA6OlxuICAgIGVsc2UgOjpcbiAgICAgIHN0YXRlLm9mZnNpZGVOZXh0T3AgPSBhdF9vZmZzaWRlLmtleXdvcmRfYXJnc1xuXG4gICAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4odHlwZSwgdmFsKVxuXG4gIGlmIHR5cGUgPT09IHR0LmF0IHx8IHR5cGUgPT09IHR0LmRvdWJsZUNvbG9uIDo6XG4gICAgY29uc3QgcG9zMCA9IHN0YXRlLnN0YXJ0XG4gICAgY29uc3QgbV9vcCA9IHJ4X29mZnNpZGVfb3AuZXhlYyBAIHRoaXMuaW5wdXQuc2xpY2UocG9zMClcbiAgICBjb25zdCBzdHJfb3AgPSBtX29wWzFdXG4gICAgY29uc3QgbGluZUVuZHNXaXRoT3AgPSAhISBtX29wWzJdXG5cbiAgICBsZXQgb3AgPSBhdF9vZmZzaWRlW3N0cl9vcF1cbiAgICBpZiBvcCA6OlxuICAgICAgaWYgb3Aua2V5d29yZEJsb2NrICYmIHJlY2VudEtleXdvcmQgJiYgdHRfb2Zmc2lkZV9rZXl3b3JkX3dpdGhfYXJncy5oYXMocmVjZW50S2V5d29yZCkgOjpcbiAgICAgICAgb3AgPSBhdF9vZmZzaWRlLmtleXdvcmRfYXJnc1xuXG4gICAgICBlbHNlIGlmIGxpbmVFbmRzV2l0aE9wICYmIG9wLm5lc3RJbm5lcjo6XG4gICAgICAgIC8vIGFsbCBvZmZzaWRlIG9wZXJhdG9ycyBhdCB0aGUgZW5kIG9mIGEgbGluZSBpbXBsaWNpdGx5IGRvbid0IG5lc3RJbm5lclxuICAgICAgICBvcCA9IEB7fSBfX3Byb3RvX186IG9wLCBuZXN0SW5uZXI6IGZhbHNlXG5cbiAgICAgIHRoaXMuZmluaXNoT2Zmc2lkZU9wKG9wLCBvcC5leHRyYUNoYXJzKVxuXG4gICAgICBpZiBvcC5uZXN0T3AgOjpcbiAgICAgICAgc3RhdGUub2Zmc2lkZU5leHRPcCA9IGF0X29mZnNpZGVbb3AubmVzdE9wXVxuICAgICAgcmV0dXJuXG5cbiAgaWYgdHQuZW9mID09PSB0eXBlIDo6XG4gICAgaWYgc3RhdGUub2Zmc2lkZS5sZW5ndGggOjpcbiAgICAgIHJldHVybiB0aGlzLnBvcE9mZnNpZGUoKVxuXG4gIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR5cGUsIHZhbClcblxuXG5wcC5vZmZzaWRlSW5kZW50ID0gZnVuY3Rpb24gKGxpbmUwLCBvdXRlckluZGVudCwgaW5uZXJJbmRlbnQpIDo6XG4gIGNvbnN0IG9mZnNpZGVfbGluZXMgPSB0aGlzLm9mZnNpZGVfbGluZXNcblxuICBpZiBudWxsID09IGlubmVySW5kZW50IDo6XG4gICAgY29uc3QgaW5uZXJMaW5lID0gb2Zmc2lkZV9saW5lc1tsaW5lMCsxXVxuICAgIGlubmVySW5kZW50ID0gaW5uZXJMaW5lID8gaW5uZXJMaW5lLmluZGVudCA6ICcnXG5cbiAgbGV0IGxpbmU9bGluZTArMSwgbGFzdD1vZmZzaWRlX2xpbmVzW2xpbmUwXVxuICB3aGlsZSBsaW5lIDwgb2Zmc2lkZV9saW5lcy5sZW5ndGggOjpcbiAgICBjb25zdCBjdXIgPSBvZmZzaWRlX2xpbmVzW2xpbmVdXG4gICAgaWYgY3VyLmNvbnRlbnQgJiYgb3V0ZXJJbmRlbnQgPj0gY3VyLmluZGVudCA6OlxuICAgICAgbGluZS0tIC8vIGJhY2t1cCB0byBwcmV2aW91cyBsaW5lXG4gICAgICBicmVha1xuXG4gICAgbGluZSsrOyBsYXN0ID0gY3VyXG4gICAgaWYgZmFsc2UgPT09IGlubmVySW5kZW50IDo6XG4gICAgICBpbm5lckluZGVudCA9IGN1ci5pbmRlbnRcbiAgICBlbHNlIGlmIGlubmVySW5kZW50ID4gY3VyLmluZGVudCA6OlxuICAgICAgaW5uZXJJbmRlbnQgPSBjdXIuaW5kZW50XG5cbiAgcmV0dXJuIEB7fSBsaW5lLCBsYXN0LCBpbm5lckluZGVudFxuXG5cbnBwLm9mZnNpZGVCbG9jayA9IGZ1bmN0aW9uIChvcCwgc3RhY2tUb3AsIHJlY2VudEtleXdvcmRUb3ApIDo6XG4gIGNvbnN0IHN0YXRlID0gdGhpcy5zdGF0ZVxuICBjb25zdCBsaW5lMCA9IHN0YXRlLmN1ckxpbmVcbiAgY29uc3QgZmlyc3QgPSB0aGlzLm9mZnNpZGVfbGluZXNbbGluZTBdXG5cbiAgbGV0IGluZGVudCwga2V5d29yZE5lc3RlZEluZGVudFxuICBpZiByZWNlbnRLZXl3b3JkVG9wIDo6XG4gICAgaW5kZW50ID0gcmVjZW50S2V5d29yZFRvcC5maXJzdC5pbmRlbnRcbiAgZWxzZSBpZiBvcC5uZXN0SW5uZXIgJiYgc3RhY2tUb3AgJiYgbGluZTAgPT09IHN0YWNrVG9wLmZpcnN0LmxpbmUgOjpcbiAgICBpbmRlbnQgPSBzdGFja1RvcC5pbm5lckluZGVudFxuICBlbHNlIGlmIG9wLmluS2V5d29yZEFyZyA6OlxuICAgIGluZGVudCA9IGZpcnN0LmluZGVudFxuICAgIGNvbnN0IGluZGVudF9ibG9jayA9IHRoaXMub2Zmc2lkZUluZGVudChsaW5lMCwgaW5kZW50KVxuICAgIGNvbnN0IGluZGVudF9rZXl3b3JkID0gdGhpcy5vZmZzaWRlSW5kZW50KGxpbmUwLCBpbmRlbnRfYmxvY2suaW5uZXJJbmRlbnQpXG4gICAgaWYgaW5kZW50X2tleXdvcmQuaW5uZXJJbmRlbnQgPiBpbmRlbnRfYmxvY2suaW5uZXJJbmRlbnQgOjpcbiAgICAgIC8vIGF1dG9kZXRlY3Qga2V5d29yZCBhcmd1bWVudCB1c2luZyAnQCcgZm9yIGZ1bmN0aW9uIGNhbGxzXG4gICAgICBpbmRlbnQgPSBpbmRlbnRfYmxvY2suaW5uZXJJbmRlbnRcbiAgICAgIGtleXdvcmROZXN0ZWRJbmRlbnQgPSBpbmRlbnRfa2V5d29yZC5pbm5lckluZGVudFxuICBlbHNlIDo6XG4gICAgaW5kZW50ID0gZmlyc3QuaW5kZW50XG5cbiAgbGV0IHtsYXN0LCBpbm5lckluZGVudH0gPSB0aGlzLm9mZnNpZGVJbmRlbnQobGluZTAsIGluZGVudCwga2V5d29yZE5lc3RlZEluZGVudClcblxuICAvLyBjYXAgdG8gXG4gIGlubmVySW5kZW50ID0gZmlyc3QuaW5kZW50ID4gaW5uZXJJbmRlbnRcbiAgICA/IGZpcnN0LmluZGVudCA6IGlubmVySW5kZW50XG5cbiAgaWYgc3RhY2tUb3AgJiYgc3RhY2tUb3AubGFzdC5wb3NMYXN0Q29udGVudCA8IGxhc3QucG9zTGFzdENvbnRlbnQ6OlxuICAgIC8vIEZpeHVwIGVuY2xvc2luZyBzY29wZXMuIEhhcHBlbnMgaW4gc2l0dWF0aW9ucyBsaWtlOiBgc2VydmVyLm9uIEAgd3JhcGVyIEAgKC4uLmFyZ3MpID0+IDo6YFxuICAgIGNvbnN0IHN0YWNrID0gc3RhdGUub2Zmc2lkZVxuICAgIGZvciBsZXQgaWR4ID0gc3RhY2subGVuZ3RoLTE7IGlkeD4wOyBpZHgtLSA6OlxuICAgICAgbGV0IHRpcCA9IHN0YWNrW2lkeF1cbiAgICAgIGlmIHRpcC5sYXN0LnBvc0xhc3RDb250ZW50ID49IGxhc3QucG9zTGFzdENvbnRlbnQgOjogYnJlYWtcbiAgICAgIHRpcC5sYXN0ID0gbGFzdFxuXG4gIHJldHVybiBAe30gb3AsIGlubmVySW5kZW50LCBmaXJzdCwgbGFzdFxuICAgICAgc3RhcnQ6IHN0YXRlLnN0YXJ0LCBlbmQ6IHN0YXRlLmVuZFxuICAgICAgbG9jOiBAe30gc3RhcnQ6IHN0YXRlLnN0YXJ0TG9jLCBlbmQ6IHN0YXRlLmVuZExvY1xuXG5cblxucHAuZmluaXNoT2Zmc2lkZU9wID0gZnVuY3Rpb24gKG9wLCBleHRyYUNoYXJzKSA6OlxuICBjb25zdCBzdGFjayA9IHRoaXMuc3RhdGUub2Zmc2lkZVxuICBsZXQgc3RhY2tUb3AgPSBzdGFja1tzdGFjay5sZW5ndGggLSAxXVxuICBsZXQgcmVjZW50S2V5d29yZFRvcFxuICBpZiBvcC5jb2RlQmxvY2sgOjpcbiAgICBpZiBzdGFja1RvcCAmJiBzdGFja1RvcC5pbktleXdvcmRBcmcgOjpcbiAgICAgIC8vIFdlJ3JlIGF0IHRoZSBlbmQgb2YgYW4gb2Zmc2lkZSBrZXl3b3JkIGJsb2NrOyByZXN0b3JlIGVuY2xvc2luZyAoKVxuICAgICAgdGhpcy5wb3BPZmZzaWRlKClcbiAgICAgIHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCA9IG9wXG4gICAgICB0aGlzLnN0YXRlLm9mZnNpZGVSZWNlbnRUb3AgPSBzdGFja1RvcFxuICAgICAgcmV0dXJuXG5cbiAgICByZWNlbnRLZXl3b3JkVG9wID0gdGhpcy5zdGF0ZS5vZmZzaWRlUmVjZW50VG9wXG4gICAgdGhpcy5zdGF0ZS5vZmZzaWRlUmVjZW50VG9wID0gbnVsbFxuXG4gIGlmIGV4dHJhQ2hhcnMgOjpcbiAgICB0aGlzLnN0YXRlLnBvcyArPSBleHRyYUNoYXJzXG5cbiAgdGhpcy5maW5pc2hUb2tlblN0YWNrKG9wLnRva2VuUHJlKVxuXG4gIGlmIHRoaXMuaXNMb29rYWhlYWQgOjogcmV0dXJuXG5cbiAgc3RhY2tUb3AgPSBzdGFja1tzdGFjay5sZW5ndGggLSAxXVxuICBjb25zdCBibGsgPSB0aGlzLm9mZnNpZGVCbG9jayhvcCwgc3RhY2tUb3AsIHJlY2VudEtleXdvcmRUb3ApXG4gIGJsay5pbktleXdvcmRBcmcgPSBvcC5pbktleXdvcmRBcmcgfHwgc3RhY2tUb3AgJiYgc3RhY2tUb3AuaW5LZXl3b3JkQXJnXG4gIHRoaXMuc3RhdGUub2Zmc2lkZS5wdXNoKGJsaylcblxuXG5wcC5fYmFzZV9za2lwU3BhY2UgPSBiYXNlUHJvdG8uc2tpcFNwYWNlXG5wcC5za2lwU3BhY2UgPSBmdW5jdGlvbigpIDo6XG4gIGNvbnN0IHN0YXRlID0gdGhpcy5zdGF0ZVxuICBpZiBudWxsICE9PSBzdGF0ZS5vZmZzaWRlTmV4dE9wIDo6IHJldHVyblxuXG4gIGNvbnN0IHN0YWNrID0gc3RhdGUub2Zmc2lkZVxuICBsZXQgc3RhY2tUb3BcbiAgaWYgc3RhY2sgJiYgc3RhY2subGVuZ3RoIDo6XG4gICAgc3RhY2tUb3AgPSBzdGFja1tzdGFjay5sZW5ndGgtMV1cbiAgICBzdGF0ZS5vZmZzaWRlUG9zID0gc3RhY2tUb3AubGFzdC5wb3NMYXN0Q29udGVudFxuICBlbHNlIDo6IHN0YXRlLm9mZnNpZGVQb3MgPSAtMVxuXG4gIHRyeSA6OlxuICAgIHRoaXMuX2Jhc2Vfc2tpcFNwYWNlKClcbiAgICBzdGF0ZS5vZmZzaWRlUG9zID0gLTFcblxuICAgIHN0YXRlLm9mZnNpZGVJbXBsaWNpdENvbW1hID0gdW5kZWZpbmVkICE9PSBzdGFja1RvcFxuICAgICAgPyB0aGlzLm9mZnNpZGVDaGVja0ltcGxpY2l0Q29tbWEoc3RhY2tUb3ApXG4gICAgICA6IG51bGxcbiAgY2F0Y2ggZXJyIDo6XG4gICAgaWYgZXJyICE9PSBvZmZzaWRlQnJlYWtvdXQgOjogdGhyb3cgZXJyXG5cblxuY29uc3QgdHRfb2Zmc2lkZV9kaXNydXB0X2ltcGxpY2l0X2NvbW1hID0gbmV3IFNldCBAI1xuICB0dC5jb21tYSwgdHQuZG90LCB0dC5hcnJvdywgdHQuY29sb24sIHR0LnNlbWksIHR0LnF1ZXN0aW9uXG5cbnBwLm9mZnNpZGVDaGVja0ltcGxpY2l0Q29tbWEgPSBmdW5jdGlvbihzdGFja1RvcCkgOjpcbiAgY29uc3Qge2ltcGxpY2l0Q29tbWFzfSA9IHN0YWNrVG9wLm9wXG4gIGlmICEgaW1wbGljaXRDb21tYXMgOjpcbiAgICByZXR1cm4gbnVsbCAvLyBub3QgZW5hYmxlZCBmb3IgdGhpcyBvZmZzaWRlIG9wXG4gIGlmICEgdGhpcy5vZmZzaWRlUGx1Z2luT3B0cy5pbXBsaWNpdF9jb21tYXMgOjpcbiAgICByZXR1cm4gbnVsbCAvLyBub3QgZW5hYmxlZCBmb3IgdGhpcyBvZmZzaWRlIG9wXG5cbiAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0YXRlLCBzdGF0ZV90eXBlPXN0YXRlLnR5cGUsIGNvbHVtbiA9IHN0YXRlLnBvcyAtIHN0YXRlLmxpbmVTdGFydFxuICBpZiBjb2x1bW4gIT09IHN0YWNrVG9wLmlubmVySW5kZW50Lmxlbmd0aCA6OlxuICAgIHJldHVybiBudWxsIC8vIG5vdCBhdCB0aGUgZXhhY3QgcmlnaHQgaW5kZW50XG4gIGlmIHN0YWNrVG9wLmVuZCA+PSBzdGF0ZS5lbmQgOjpcbiAgICByZXR1cm4gZmFsc2UgLy8gbm8gY29tbWEgYmVmb3JlIHRoZSBmaXJzdCBlbGVtZW50XG4gIGlmIHR0LmNvbW1hID09PSBzdGF0ZV90eXBlIDo6XG4gICAgcmV0dXJuIGZhbHNlIC8vIHRoZXJlJ3MgYW4gZXhwbGljaXQgY29tbWEgYWxyZWFkeSBwcmVzZW50XG4gIGlmIHN0YXRlX3R5cGUuYmlub3AgfHwgc3RhdGVfdHlwZS5iZWZvcmVFeHByIDo6XG4gICAgcmV0dXJuIGZhbHNlIC8vIHRoZXJlJ3MgYW4gb3BlcmF0b3Igb3IgYXJyb3cgZnVuY3Rpb24gcHJlY2VlZGluZyB0aGlzIGxpbmVcblxuICBpZiB0aGlzLmlzTG9va2FoZWFkIDo6IHJldHVybiBmYWxzZSAvLyBkaXNhbGxvdyByZWN1cnNpdmUgbG9va2FoZWFkXG4gIGNvbnN0IHt0eXBlOiBuZXh0X3R5cGV9ID0gdGhpcy5sb29rYWhlYWQoKVxuXG4gIGlmIHR0X29mZnNpZGVfZGlzcnVwdF9pbXBsaWNpdF9jb21tYS5oYXMobmV4dF90eXBlKSA6OlxuICAgIHJldHVybiBmYWxzZSAvLyB0aGVyZSdzIGEgY29tbWEsIGRvdCwgb3IgZnVuY3Rpb24gYXJyb3cgdG9rZW4gdGhhdCBwcmVjbHVkZXMgYW4gaW1wbGljaXQgbGVhZGluZyBjb21tYVxuICBpZiBuZXh0X3R5cGUuYmlub3AgOjpcbiAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgaW1wbGljaXRDb21tYXMuaGFzIDo6XG4gICAgICAvLyBhbGxvdyBmb3IgdHQuc3RhciBpbiBjZXJ0YWluIGNvbnRleHRzIOKAlCBlLmcuIGZvciBnZW5lcmF0b3IgbWV0aG9kIGRlZmludGlvbnNcbiAgICAgIHJldHVybiBpbXBsaWNpdENvbW1hcy5oYXMobmV4dF90eXBlKVxuXG4gICAgcmV0dXJuIGZhbHNlIC8vIHRoZXJlJ3MgYSBiaW5hcnkgb3BlcmF0b3IgdGhhdCBwcmVjbHVkZXMgYW4gaW1wbGljaXQgbGVhZGluZyBjb21tYVxuICBlbHNlIDo6XG4gICAgcmV0dXJuIHRydWUgLy8gYW4gaW1wbGljaXQgY29tbWEgaXMgbmVlZGVkXG5cbnBwLl9iYXNlX3JlYWRUb2tlbiA9IGJhc2VQcm90by5yZWFkVG9rZW5cbnBwLnJlYWRUb2tlbiA9IGZ1bmN0aW9uKGNvZGUpIDo6XG4gIGNvbnN0IHJlcyA9IF9pbm5lci5jYWxsKHRoaXMsIGNvZGUpXG4gIC8vY29uc29sZS5kaXIodGhpcywge2NvbG9yczp0cnVlfSlcbiAgcmV0dXJuIHJlc1xuXG4gIGZ1bmN0aW9uIF9pbm5lcihjb2RlKSA6OlxuICAgIGNvbnN0IHN0YXRlID0gdGhpcy5zdGF0ZVxuXG4gICAgaWYgc3RhdGUub2Zmc2lkZVRva2VuU3RhY2subGVuZ3RoIDo6XG4gICAgICBjb25zdCBoZWFkID0gc3RhdGUub2Zmc2lkZVRva2VuU3RhY2suc2hpZnQoKVxuICAgICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBoZWFkIDo6XG4gICAgICAgIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR0Lm5hbWUsIGhlYWQpXG4gICAgICBlbHNlIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKGhlYWQpXG5cbiAgICBpZiBzdGF0ZS5vZmZzaWRlSW1wbGljaXRDb21tYSA6OlxuICAgICAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4odHQuY29tbWEpXG5cbiAgICBjb25zdCBvZmZzaWRlTmV4dE9wID0gc3RhdGUub2Zmc2lkZU5leHRPcFxuICAgIGlmIG51bGwgIT09IG9mZnNpZGVOZXh0T3AgOjpcbiAgICAgIHN0YXRlLm9mZnNpZGVOZXh0T3AgPSBudWxsXG4gICAgICByZXR1cm4gdGhpcy5maW5pc2hPZmZzaWRlT3Aob2Zmc2lkZU5leHRPcClcblxuICAgIGlmIHN0YXRlLnBvcyA9PT0gc3RhdGUub2Zmc2lkZVBvcyA6OlxuICAgICAgcmV0dXJuIHRoaXMucG9wT2Zmc2lkZSgpXG5cbiAgICByZXR1cm4gdGhpcy5fYmFzZV9yZWFkVG9rZW4oY29kZSlcblxucHAucG9wT2Zmc2lkZSA9IGZ1bmN0aW9uKCkgOjpcbiAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YXRlLm9mZnNpZGVcbiAgY29uc3Qgc3RhY2tUb3AgPSB0aGlzLmlzTG9va2FoZWFkXG4gICAgPyBzdGFja1tzdGFjay5sZW5ndGgtMV1cbiAgICA6IHN0YWNrLnBvcCgpXG4gIHRoaXMuc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG5cbiAgdGhpcy5maW5pc2hUb2tlblN0YWNrKHN0YWNrVG9wLm9wLnRva2VuUG9zdClcbiAgcmV0dXJuIHN0YWNrVG9wXG5cblxucmV0dXJuIFBhcnNlclxufSAvLyBlbmQgcGVyLWJhYnlsb24gaW5zdGFuY2UgbW9ua2V5cGF0Y2hpbmdcbiJdfQ==