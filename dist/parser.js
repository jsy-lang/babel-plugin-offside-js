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
      if (innerIndent > cur.indent) {
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

    this._base_finishToken(op.tokenPre);

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

  const tt_offside_disrupt_implicit_comma = new Set([tt.comma, tt.dot, tt.arrow, tt.semi]);

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

    this._base_finishToken(stackTop.op.tokenPost);
    return stackTop;
  };

  return Parser;
} // end per-babylon instance monkeypatching
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL2NvZGUvcGFyc2VyLmpzIl0sIm5hbWVzIjpbImhvb2tCYWJ5bG9uIiwiaW5zdGFsbE9mZnNpZGVCYWJ5bG9uUGFyc2VycyIsImFzT2Zmc2lkZUpTQmFieWxvblBhcnNlciIsImJhYnlsb24iLCJQYXJzZXIiLCJ0Z3RfcGF0Y2giLCJ0b2tUeXBlcyIsImJyYWNlTCIsImZuX3VwZGF0ZUNvbnRleHQiLCJ1cGRhdGVDb250ZXh0IiwicHJldlR5cGUiLCJjb25zdHJ1Y3RvciIsInBhcnNlIiwiRXJyb3IiLCJob29rTGlzdCIsInB1c2giLCJyZXF1aXJlIiwiZXJyIiwibGVuZ3RoIiwibWFwIiwiYmFzZVByb3RvIiwicHJvdG90eXBlIiwicHAiLCJPYmplY3QiLCJjcmVhdGUiLCJ0dCIsImF0X29mZnNpZGUiLCJfZ19vZmZzaWRlUGx1Z2luT3B0cyIsIl9iYXNlX21vZHVsZV9wYXJzZSIsImlucHV0Iiwib3B0aW9ucyIsIm9mZnNpZGVQbHVnaW5PcHRzIiwidW5kZWZpbmVkIiwiX2Jhc2VfcGFyc2UiLCJpbml0T2Zmc2lkZSIsIk9mZnNpZGVCcmVha291dCIsIm9mZnNpZGVCcmVha291dCIsInN0YXRlIiwib2Zmc2lkZSIsIm9mZnNpZGVOZXh0T3AiLCJvZmZzaWRlX2xpbmVzIiwiX3BvcyIsInBvcyIsImRlZmluZVByb3BlcnR5IiwiZW51bWVyYWJsZSIsImdldCIsInNldCIsIm9mZlBvcyIsIm9mZnNpZGVQb3MiLCJ0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzIiwiU2V0IiwiX2lmIiwiX3doaWxlIiwiX2ZvciIsIl9jYXRjaCIsIl9zd2l0Y2giLCJ0dF9vZmZzaWRlX2tleXdvcmRfbG9va2FoZWFkX3NraXAiLCJwYXJlbkwiLCJjb2xvbiIsImNvbW1hIiwiZG90IiwiaXNGb3JBd2FpdCIsImtleXdvcmRUeXBlIiwidHlwZSIsInZhbCIsIm5hbWUiLCJyeF9vZmZzaWRlX29wIiwiX2Jhc2VfZmluaXNoVG9rZW4iLCJmaW5pc2hUb2tlbiIsInJlY2VudEtleXdvcmQiLCJvZmZzaWRlUmVjZW50S2V5d29yZCIsImluRm9yQXdhaXQiLCJoYXMiLCJpc0tleXdvcmRBbGxvd2VkIiwiaXNMb29rYWhlYWQiLCJsb29rYWhlYWQiLCJ2YWx1ZSIsImtleXdvcmRfYXJncyIsImF0IiwiZG91YmxlQ29sb24iLCJwb3MwIiwic3RhcnQiLCJwb3MxIiwibV9vcCIsImV4ZWMiLCJzbGljZSIsInN0cl9vcCIsImxpbmVFbmRzV2l0aE9wIiwib3AiLCJrZXl3b3JkQmxvY2siLCJuZXN0SW5uZXIiLCJfX3Byb3RvX18iLCJmaW5pc2hPZmZzaWRlT3AiLCJleHRyYUNoYXJzIiwibmVzdE9wIiwiZW9mIiwicG9wT2Zmc2lkZSIsIm9mZnNpZGVJbmRlbnQiLCJsaW5lMCIsIm91dGVySW5kZW50IiwiaW5uZXJJbmRlbnQiLCJpbm5lckxpbmUiLCJpbmRlbnQiLCJsaW5lIiwibGFzdCIsImN1ciIsImNvbnRlbnQiLCJvZmZzaWRlQmxvY2siLCJzdGFja1RvcCIsInJlY2VudEtleXdvcmRUb3AiLCJjdXJMaW5lIiwiZmlyc3QiLCJrZXl3b3JkTmVzdGVkSW5kZW50IiwiaW5LZXl3b3JkQXJnIiwiaW5kZW50X2Jsb2NrIiwiaW5kZW50X2tleXdvcmQiLCJwb3NMYXN0Q29udGVudCIsInN0YWNrIiwiaWR4IiwidGlwIiwiZW5kIiwibG9jIiwic3RhcnRMb2MiLCJlbmRMb2MiLCJjb2RlQmxvY2siLCJvZmZzaWRlUmVjZW50VG9wIiwidG9rZW5QcmUiLCJibGsiLCJfYmFzZV9za2lwU3BhY2UiLCJza2lwU3BhY2UiLCJvZmZzaWRlSW1wbGljaXRDb21tYSIsIm9mZnNpZGVDaGVja0ltcGxpY2l0Q29tbWEiLCJ0dF9vZmZzaWRlX2Rpc3J1cHRfaW1wbGljaXRfY29tbWEiLCJhcnJvdyIsInNlbWkiLCJpbXBsaWNpdENvbW1hcyIsImltcGxpY2l0X2NvbW1hcyIsInN0YXRlX3R5cGUiLCJjb2x1bW4iLCJsaW5lU3RhcnQiLCJiaW5vcCIsImJlZm9yZUV4cHIiLCJuZXh0X3R5cGUiLCJf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dkMsUUFBUDtBQUFlLEdBUmpCOztBQVdBLFNBQU94RyxNQUFQO0FBQ0MsQyxDQUFDIiwiZmlsZSI6InBhcnNlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7b2Zmc2lkZU9wZXJhdG9yc0ZvckJhYnlsb24sIHBhcnNlT2Zmc2lkZUluZGV4TWFwfSBmcm9tICcuL29mZnNpZGVfb3BzJ1xuXG5leHBvcnQgZnVuY3Rpb24gaG9va0JhYnlsb24oYmFieWxvbikgOjpcbiAgLy8gYWJ1c2UgQmFieWxvbiB0b2tlbiB1cGRhdGVDb250ZXh0IGNhbGxiYWNrIGV4dHJhY3RcbiAgLy8gdGhlIHJlZmVyZW5jZSB0byBQYXJzZXJcblxuICBsZXQgUGFyc2VyXG4gIGNvbnN0IHRndF9wYXRjaCA9IGJhYnlsb24udG9rVHlwZXMuYnJhY2VMXG4gIGNvbnN0IGZuX3VwZGF0ZUNvbnRleHQgPSB0Z3RfcGF0Y2gudXBkYXRlQ29udGV4dFxuICB0Z3RfcGF0Y2gudXBkYXRlQ29udGV4dCA9IGZ1bmN0aW9uIChwcmV2VHlwZSkgOjpcbiAgICB0Z3RfcGF0Y2gudXBkYXRlQ29udGV4dCA9IGZuX3VwZGF0ZUNvbnRleHRcbiAgICBQYXJzZXIgPSB0aGlzLmNvbnN0cnVjdG9yXG5cbiAgYmFieWxvbi5wYXJzZSgne30nKVxuICBpZiAhIFBhcnNlciA6OlxuICAgIHRocm93IG5ldyBFcnJvciBAIFwiRmFpbGVkIHRvIGhvb2sgQmFieWxvbiBQYXJzZXJcIlxuICByZXR1cm4gUGFyc2VyXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGluc3RhbGxPZmZzaWRlQmFieWxvblBhcnNlcnMoKSA6OlxuICBjb25zdCBob29rTGlzdCA9IFtdXG5cbiAgdHJ5IDo6IGhvb2tMaXN0LnB1c2ggQFxuICAgIHJlcXVpcmUoJ2JhYnlsb24nKVxuICBjYXRjaCBlcnIgOjpcblxuICB0cnkgOjogaG9va0xpc3QucHVzaCBAXG4gICAgcmVxdWlyZSgnYmFiZWwtY2xpL25vZGVfbW9kdWxlcy9iYWJ5bG9uJylcbiAgY2F0Y2ggZXJyIDo6XG5cbiAgdHJ5IDo6IGhvb2tMaXN0LnB1c2ggQFxuICAgIHJlcXVpcmUoJ2JhYmVsLWNvcmUvbm9kZV9tb2R1bGVzL2JhYnlsb24nKVxuICBjYXRjaCBlcnIgOjpcblxuICBpZiAwID09PSBob29rTGlzdC5sZW5ndGggOjpcbiAgICB0aHJvdyBuZXcgRXJyb3IgQCBgVW5hYmxlIHRvIGxvYWQgXCJiYWJ5bG9uXCIgcGFyc2VyIHBhY2thZ2VgXG5cbiAgcmV0dXJuIGhvb2tMaXN0Lm1hcCBAIGJhYnlsb24gPT5cbiAgICBhc09mZnNpZGVKU0JhYnlsb25QYXJzZXIoYmFieWxvbilcbiAgXG5cbmV4cG9ydCBmdW5jdGlvbiBhc09mZnNpZGVKU0JhYnlsb25QYXJzZXIoYmFieWxvbilcbnsgLy8gYmVnaW4gcGVyLWJhYnlsb24gaW5zdGFuY2UgbW9ua2V5cGF0Y2hpbmdcblxuY29uc3QgUGFyc2VyID0gaG9va0JhYnlsb24oYmFieWxvbilcbmNvbnN0IGJhc2VQcm90byA9IFBhcnNlci5wcm90b3R5cGVcbmNvbnN0IHBwID0gUGFyc2VyLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoYmFzZVByb3RvKVxuY29uc3QgdHQgPSBiYWJ5bG9uLnRva1R5cGVzXG5cbmNvbnN0IGF0X29mZnNpZGUgPSBvZmZzaWRlT3BlcmF0b3JzRm9yQmFieWxvbih0dClcblxudmFyIF9nX29mZnNpZGVQbHVnaW5PcHRzXG5cbmNvbnN0IF9iYXNlX21vZHVsZV9wYXJzZSA9IGJhYnlsb24ucGFyc2VcbmJhYnlsb24ucGFyc2UgPSAoaW5wdXQsIG9wdGlvbnMpID0+IDo6XG4gIF9nX29mZnNpZGVQbHVnaW5PcHRzID0gb3B0aW9ucyA/IG9wdGlvbnMub2Zmc2lkZVBsdWdpbk9wdHMgOiB1bmRlZmluZWRcbiAgcmV0dXJuIF9iYXNlX21vZHVsZV9wYXJzZShpbnB1dCwgb3B0aW9ucylcblxuXG5wcC5fYmFzZV9wYXJzZSA9IGJhc2VQcm90by5wYXJzZVxucHAucGFyc2UgPSBmdW5jdGlvbigpIDo6XG4gIHRoaXMuaW5pdE9mZnNpZGUoKVxuICByZXR1cm4gdGhpcy5fYmFzZV9wYXJzZSgpXG5cblxuY2xhc3MgT2Zmc2lkZUJyZWFrb3V0IGV4dGVuZHMgRXJyb3Ige31cbmNvbnN0IG9mZnNpZGVCcmVha291dCA9IG5ldyBPZmZzaWRlQnJlYWtvdXQoKVxuXG5wcC5pbml0T2Zmc2lkZSA9IGZ1bmN0aW9uKCkgOjpcbiAgdGhpcy5zdGF0ZS5vZmZzaWRlID0gW11cbiAgdGhpcy5zdGF0ZS5vZmZzaWRlTmV4dE9wID0gbnVsbFxuICB0aGlzLm9mZnNpZGVfbGluZXMgPSBwYXJzZU9mZnNpZGVJbmRleE1hcCh0aGlzLmlucHV0KVxuICB0aGlzLm9mZnNpZGVQbHVnaW5PcHRzID0gX2dfb2Zmc2lkZVBsdWdpbk9wdHMgfHwge31cbiAgX2dfb2Zmc2lkZVBsdWdpbk9wdHMgPSBudWxsXG5cbiAgdGhpcy5zdGF0ZS5fcG9zID0gdGhpcy5zdGF0ZS5wb3NcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5IEAgdGhpcy5zdGF0ZSwgJ3BvcycsIEB7fVxuICAgIGVudW1lcmFibGU6IHRydWVcbiAgICBnZXQoKSA6OiByZXR1cm4gdGhpcy5fcG9zXG4gICAgc2V0KHBvcykgOjpcbiAgICAgIC8vIGludGVycnVwdCBza2lwU3BhY2UgYWxnb3JpdGhtIHdoZW4gd2UgaGl0IG91ciBwb3NpdGlvbiAnYnJlYWtwb2ludCdcbiAgICAgIGNvbnN0IG9mZlBvcyA9IHRoaXMub2Zmc2lkZVBvc1xuICAgICAgaWYgb2ZmUG9zPj0wICYmIChwb3MgPiBvZmZQb3MpIDo6XG4gICAgICAgIHRocm93IG9mZnNpZGVCcmVha291dFxuXG4gICAgICB0aGlzLl9wb3MgPSBwb3NcblxuXG5jb25zdCB0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzID0gbmV3IFNldCBAI1xuICAgICAgdHQuX2lmLCB0dC5fd2hpbGUsIHR0Ll9mb3JcbiAgICAgIHR0Ll9jYXRjaCwgdHQuX3N3aXRjaFxuXG5jb25zdCB0dF9vZmZzaWRlX2tleXdvcmRfbG9va2FoZWFkX3NraXAgPSBuZXcgU2V0IEAjXG4gICAgICB0dC5wYXJlbkwsIHR0LmNvbG9uLCB0dC5jb21tYSwgdHQuZG90XG5cbnBwLmlzRm9yQXdhaXQgPSBmdW5jdGlvbiAoa2V5d29yZFR5cGUsIHR5cGUsIHZhbCkgOjpcbiAgcmV0dXJuIHR0Ll9mb3IgPT09IGtleXdvcmRUeXBlXG4gICAgJiYgdHQubmFtZSA9PT0gdHlwZVxuICAgICYmICdhd2FpdCcgPT09IHZhbFxuXG5jb25zdCByeF9vZmZzaWRlX29wID0gLyhcXFMrKVsgXFx0XSooXFxyXFxufFxccnxcXG4pPy9cblxucHAuX2Jhc2VfZmluaXNoVG9rZW4gPSBiYXNlUHJvdG8uZmluaXNoVG9rZW5cbnBwLmZpbmlzaFRva2VuID0gZnVuY3Rpb24odHlwZSwgdmFsKSA6OlxuICBjb25zdCBzdGF0ZSA9IHRoaXMuc3RhdGVcbiAgY29uc3QgcmVjZW50S2V5d29yZCA9IHN0YXRlLm9mZnNpZGVSZWNlbnRLZXl3b3JkXG4gIGNvbnN0IGluRm9yQXdhaXQgPSByZWNlbnRLZXl3b3JkID8gdGhpcy5pc0ZvckF3YWl0KHJlY2VudEtleXdvcmQsIHR5cGUsIHZhbCkgOiBudWxsXG4gIHN0YXRlLm9mZnNpZGVSZWNlbnRLZXl3b3JkID0gbnVsbFxuXG4gIGlmIHR0X29mZnNpZGVfa2V5d29yZF93aXRoX2FyZ3MuaGFzKHR5cGUpIHx8IGluRm9yQXdhaXQgOjpcbiAgICBjb25zdCBpc0tleXdvcmRBbGxvd2VkID0gIXRoaXMuaXNMb29rYWhlYWRcbiAgICAgICYmIHR0LmRvdCAhPT0gc3RhdGUudHlwZVxuXG4gICAgaWYgIWlzS2V5d29yZEFsbG93ZWQgOjpcbiAgICAgIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR5cGUsIHZhbClcblxuICAgIHN0YXRlLm9mZnNpZGVSZWNlbnRLZXl3b3JkID0gaW5Gb3JBd2FpdCA/IHR0Ll9mb3IgOiB0eXBlXG4gICAgY29uc3QgbG9va2FoZWFkID0gdGhpcy5sb29rYWhlYWQoKVxuXG4gICAgaWYgdHRfb2Zmc2lkZV9rZXl3b3JkX2xvb2thaGVhZF9za2lwLmhhcyhsb29rYWhlYWQudHlwZSkgOjpcbiAgICBlbHNlIGlmIHRoaXMuaXNGb3JBd2FpdCh0eXBlLCBsb29rYWhlYWQudHlwZSwgbG9va2FoZWFkLnZhbHVlKSA6OlxuICAgIGVsc2UgOjpcbiAgICAgIHN0YXRlLm9mZnNpZGVOZXh0T3AgPSBhdF9vZmZzaWRlLmtleXdvcmRfYXJnc1xuXG4gICAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4odHlwZSwgdmFsKVxuXG4gIGlmIHR5cGUgPT09IHR0LmF0IHx8IHR5cGUgPT09IHR0LmRvdWJsZUNvbG9uIDo6XG4gICAgY29uc3QgcG9zMCA9IHN0YXRlLnN0YXJ0LCBwb3MxID0gc3RhdGUucG9zICsgMlxuICAgIGNvbnN0IG1fb3AgPSByeF9vZmZzaWRlX29wLmV4ZWMgQCB0aGlzLmlucHV0LnNsaWNlKHBvczApXG4gICAgY29uc3Qgc3RyX29wID0gbV9vcFsxXVxuICAgIGNvbnN0IGxpbmVFbmRzV2l0aE9wID0gISEgbV9vcFsyXVxuXG4gICAgbGV0IG9wID0gYXRfb2Zmc2lkZVtzdHJfb3BdXG4gICAgaWYgb3AgOjpcbiAgICAgIGlmIG9wLmtleXdvcmRCbG9jayAmJiByZWNlbnRLZXl3b3JkICYmIHR0X29mZnNpZGVfa2V5d29yZF93aXRoX2FyZ3MuaGFzKHJlY2VudEtleXdvcmQpIDo6XG4gICAgICAgIG9wID0gYXRfb2Zmc2lkZS5rZXl3b3JkX2FyZ3NcblxuICAgICAgZWxzZSBpZiBsaW5lRW5kc1dpdGhPcCAmJiBvcC5uZXN0SW5uZXI6OlxuICAgICAgICAvLyBhbGwgb2Zmc2lkZSBvcGVyYXRvcnMgYXQgdGhlIGVuZCBvZiBhIGxpbmUgaW1wbGljaXRseSBkb24ndCBuZXN0SW5uZXJcbiAgICAgICAgb3AgPSBAe30gX19wcm90b19fOiBvcCwgbmVzdElubmVyOiBmYWxzZVxuXG4gICAgICB0aGlzLmZpbmlzaE9mZnNpZGVPcChvcCwgb3AuZXh0cmFDaGFycylcblxuICAgICAgaWYgb3AubmVzdE9wIDo6XG4gICAgICAgIHN0YXRlLm9mZnNpZGVOZXh0T3AgPSBhdF9vZmZzaWRlW29wLm5lc3RPcF1cbiAgICAgIHJldHVyblxuXG4gIGlmIHR0LmVvZiA9PT0gdHlwZSA6OlxuICAgIGlmIHN0YXRlLm9mZnNpZGUubGVuZ3RoIDo6XG4gICAgICByZXR1cm4gdGhpcy5wb3BPZmZzaWRlKClcblxuICByZXR1cm4gdGhpcy5fYmFzZV9maW5pc2hUb2tlbih0eXBlLCB2YWwpXG5cblxucHAub2Zmc2lkZUluZGVudCA9IGZ1bmN0aW9uIChsaW5lMCwgb3V0ZXJJbmRlbnQsIGlubmVySW5kZW50KSA6OlxuICBjb25zdCBvZmZzaWRlX2xpbmVzID0gdGhpcy5vZmZzaWRlX2xpbmVzXG5cbiAgaWYgbnVsbCA9PSBpbm5lckluZGVudCA6OlxuICAgIGNvbnN0IGlubmVyTGluZSA9IG9mZnNpZGVfbGluZXNbbGluZTArMV1cbiAgICBpbm5lckluZGVudCA9IGlubmVyTGluZSA/IGlubmVyTGluZS5pbmRlbnQgOiAnJ1xuXG4gIGxldCBsaW5lPWxpbmUwKzEsIGxhc3Q9b2Zmc2lkZV9saW5lc1tsaW5lMF1cbiAgd2hpbGUgbGluZSA8IG9mZnNpZGVfbGluZXMubGVuZ3RoIDo6XG4gICAgY29uc3QgY3VyID0gb2Zmc2lkZV9saW5lc1tsaW5lXVxuICAgIGlmIGN1ci5jb250ZW50ICYmIG91dGVySW5kZW50ID49IGN1ci5pbmRlbnQgOjpcbiAgICAgIGxpbmUtLSAvLyBiYWNrdXAgdG8gcHJldmlvdXMgbGluZVxuICAgICAgYnJlYWtcblxuICAgIGxpbmUrKzsgbGFzdCA9IGN1clxuICAgIGlmIGlubmVySW5kZW50ID4gY3VyLmluZGVudCA6OlxuICAgICAgaW5uZXJJbmRlbnQgPSBjdXIuaW5kZW50XG5cbiAgcmV0dXJuIEB7fSBsaW5lLCBsYXN0LCBpbm5lckluZGVudFxuXG5cbnBwLm9mZnNpZGVCbG9jayA9IGZ1bmN0aW9uIChvcCwgc3RhY2tUb3AsIHJlY2VudEtleXdvcmRUb3ApIDo6XG4gIGNvbnN0IHN0YXRlID0gdGhpcy5zdGF0ZVxuICBjb25zdCBsaW5lMCA9IHN0YXRlLmN1ckxpbmVcbiAgY29uc3QgZmlyc3QgPSB0aGlzLm9mZnNpZGVfbGluZXNbbGluZTBdXG5cbiAgbGV0IGluZGVudCwga2V5d29yZE5lc3RlZEluZGVudFxuICBpZiByZWNlbnRLZXl3b3JkVG9wIDo6XG4gICAgaW5kZW50ID0gcmVjZW50S2V5d29yZFRvcC5maXJzdC5pbmRlbnRcbiAgZWxzZSBpZiBvcC5uZXN0SW5uZXIgJiYgc3RhY2tUb3AgJiYgbGluZTAgPT09IHN0YWNrVG9wLmZpcnN0LmxpbmUgOjpcbiAgICBpbmRlbnQgPSBzdGFja1RvcC5pbm5lckluZGVudFxuICBlbHNlIGlmIG9wLmluS2V5d29yZEFyZyA6OlxuICAgIGluZGVudCA9IGZpcnN0LmluZGVudFxuICAgIGNvbnN0IGluZGVudF9ibG9jayA9IHRoaXMub2Zmc2lkZUluZGVudChsaW5lMCwgaW5kZW50KVxuICAgIGNvbnN0IGluZGVudF9rZXl3b3JkID0gdGhpcy5vZmZzaWRlSW5kZW50KGxpbmUwLCBpbmRlbnRfYmxvY2suaW5uZXJJbmRlbnQpXG4gICAgaWYgaW5kZW50X2tleXdvcmQuaW5uZXJJbmRlbnQgPiBpbmRlbnRfYmxvY2suaW5uZXJJbmRlbnQgOjpcbiAgICAgIC8vIGF1dG9kZXRlY3Qga2V5d29yZCBhcmd1bWVudCB1c2luZyAnQCcgZm9yIGZ1bmN0aW9uIGNhbGxzXG4gICAgICBpbmRlbnQgPSBpbmRlbnRfYmxvY2suaW5uZXJJbmRlbnRcbiAgICAgIGtleXdvcmROZXN0ZWRJbmRlbnQgPSBpbmRlbnRfa2V5d29yZC5pbm5lckluZGVudFxuICBlbHNlIDo6XG4gICAgaW5kZW50ID0gZmlyc3QuaW5kZW50XG5cbiAgbGV0IHtsYXN0LCBpbm5lckluZGVudH0gPSB0aGlzLm9mZnNpZGVJbmRlbnQobGluZTAsIGluZGVudCwga2V5d29yZE5lc3RlZEluZGVudClcblxuICAvLyBjYXAgdG8gXG4gIGlubmVySW5kZW50ID0gZmlyc3QuaW5kZW50ID4gaW5uZXJJbmRlbnRcbiAgICA/IGZpcnN0LmluZGVudCA6IGlubmVySW5kZW50XG5cbiAgaWYgc3RhY2tUb3AgJiYgc3RhY2tUb3AubGFzdC5wb3NMYXN0Q29udGVudCA8IGxhc3QucG9zTGFzdENvbnRlbnQ6OlxuICAgIC8vIEZpeHVwIGVuY2xvc2luZyBzY29wZXMuIEhhcHBlbnMgaW4gc2l0dWF0aW9ucyBsaWtlOiBgc2VydmVyLm9uIEAgd3JhcGVyIEAgKC4uLmFyZ3MpID0+IDo6YFxuICAgIGNvbnN0IHN0YWNrID0gc3RhdGUub2Zmc2lkZVxuICAgIGZvciBsZXQgaWR4ID0gc3RhY2subGVuZ3RoLTE7IGlkeD4wOyBpZHgtLSA6OlxuICAgICAgbGV0IHRpcCA9IHN0YWNrW2lkeF1cbiAgICAgIGlmIHRpcC5sYXN0LnBvc0xhc3RDb250ZW50ID49IGxhc3QucG9zTGFzdENvbnRlbnQgOjogYnJlYWtcbiAgICAgIHRpcC5sYXN0ID0gbGFzdFxuXG4gIHJldHVybiBAe30gb3AsIGlubmVySW5kZW50LCBmaXJzdCwgbGFzdFxuICAgICAgc3RhcnQ6IHN0YXRlLnN0YXJ0LCBlbmQ6IHN0YXRlLmVuZFxuICAgICAgbG9jOiBAe30gc3RhcnQ6IHN0YXRlLnN0YXJ0TG9jLCBlbmQ6IHN0YXRlLmVuZExvY1xuXG5cblxucHAuZmluaXNoT2Zmc2lkZU9wID0gZnVuY3Rpb24gKG9wLCBleHRyYUNoYXJzKSA6OlxuICBjb25zdCBzdGFjayA9IHRoaXMuc3RhdGUub2Zmc2lkZVxuICBsZXQgc3RhY2tUb3AgPSBzdGFja1tzdGFjay5sZW5ndGggLSAxXVxuICBsZXQgcmVjZW50S2V5d29yZFRvcFxuICBpZiBvcC5jb2RlQmxvY2sgOjpcbiAgICBpZiBzdGFja1RvcCAmJiBzdGFja1RvcC5pbktleXdvcmRBcmcgOjpcbiAgICAgIC8vIFdlJ3JlIGF0IHRoZSBlbmQgb2YgYW4gb2Zmc2lkZSBrZXl3b3JkIGJsb2NrOyByZXN0b3JlIGVuY2xvc2luZyAoKVxuICAgICAgdGhpcy5wb3BPZmZzaWRlKClcbiAgICAgIHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCA9IG9wXG4gICAgICB0aGlzLnN0YXRlLm9mZnNpZGVSZWNlbnRUb3AgPSBzdGFja1RvcFxuICAgICAgcmV0dXJuXG5cbiAgICByZWNlbnRLZXl3b3JkVG9wID0gdGhpcy5zdGF0ZS5vZmZzaWRlUmVjZW50VG9wXG4gICAgdGhpcy5zdGF0ZS5vZmZzaWRlUmVjZW50VG9wID0gbnVsbFxuXG4gIGlmIGV4dHJhQ2hhcnMgOjpcbiAgICB0aGlzLnN0YXRlLnBvcyArPSBleHRyYUNoYXJzXG5cbiAgdGhpcy5fYmFzZV9maW5pc2hUb2tlbihvcC50b2tlblByZSlcblxuICBpZiB0aGlzLmlzTG9va2FoZWFkIDo6IHJldHVyblxuXG4gIHN0YWNrVG9wID0gc3RhY2tbc3RhY2subGVuZ3RoIC0gMV1cbiAgY29uc3QgYmxrID0gdGhpcy5vZmZzaWRlQmxvY2sob3AsIHN0YWNrVG9wLCByZWNlbnRLZXl3b3JkVG9wKVxuICBibGsuaW5LZXl3b3JkQXJnID0gb3AuaW5LZXl3b3JkQXJnIHx8IHN0YWNrVG9wICYmIHN0YWNrVG9wLmluS2V5d29yZEFyZ1xuICB0aGlzLnN0YXRlLm9mZnNpZGUucHVzaChibGspXG5cblxucHAuX2Jhc2Vfc2tpcFNwYWNlID0gYmFzZVByb3RvLnNraXBTcGFjZVxucHAuc2tpcFNwYWNlID0gZnVuY3Rpb24oKSA6OlxuICBjb25zdCBzdGF0ZSA9IHRoaXMuc3RhdGVcbiAgaWYgbnVsbCAhPT0gc3RhdGUub2Zmc2lkZU5leHRPcCA6OiByZXR1cm5cblxuICBjb25zdCBzdGFjayA9IHN0YXRlLm9mZnNpZGVcbiAgbGV0IHN0YWNrVG9wXG4gIGlmIHN0YWNrICYmIHN0YWNrLmxlbmd0aCA6OlxuICAgIHN0YWNrVG9wID0gc3RhY2tbc3RhY2subGVuZ3RoLTFdXG4gICAgc3RhdGUub2Zmc2lkZVBvcyA9IHN0YWNrVG9wLmxhc3QucG9zTGFzdENvbnRlbnRcbiAgZWxzZSA6OiBzdGF0ZS5vZmZzaWRlUG9zID0gLTFcblxuICB0cnkgOjpcbiAgICB0aGlzLl9iYXNlX3NraXBTcGFjZSgpXG4gICAgc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG5cbiAgICBzdGF0ZS5vZmZzaWRlSW1wbGljaXRDb21tYSA9IHVuZGVmaW5lZCAhPT0gc3RhY2tUb3BcbiAgICAgID8gdGhpcy5vZmZzaWRlQ2hlY2tJbXBsaWNpdENvbW1hKHN0YWNrVG9wKVxuICAgICAgOiBudWxsXG4gIGNhdGNoIGVyciA6OlxuICAgIGlmIGVyciAhPT0gb2Zmc2lkZUJyZWFrb3V0IDo6IHRocm93IGVyclxuXG5cbmNvbnN0IHR0X29mZnNpZGVfZGlzcnVwdF9pbXBsaWNpdF9jb21tYSA9IG5ldyBTZXQgQCNcbiAgdHQuY29tbWEsIHR0LmRvdCwgdHQuYXJyb3csIHR0LnNlbWlcblxucHAub2Zmc2lkZUNoZWNrSW1wbGljaXRDb21tYSA9IGZ1bmN0aW9uKHN0YWNrVG9wKSA6OlxuICBjb25zdCB7aW1wbGljaXRDb21tYXN9ID0gc3RhY2tUb3Aub3BcbiAgaWYgISBpbXBsaWNpdENvbW1hcyA6OlxuICAgIHJldHVybiBudWxsIC8vIG5vdCBlbmFibGVkIGZvciB0aGlzIG9mZnNpZGUgb3BcbiAgaWYgISB0aGlzLm9mZnNpZGVQbHVnaW5PcHRzLmltcGxpY2l0X2NvbW1hcyA6OlxuICAgIHJldHVybiBudWxsIC8vIG5vdCBlbmFibGVkIGZvciB0aGlzIG9mZnNpZGUgb3BcblxuICBjb25zdCBzdGF0ZSA9IHRoaXMuc3RhdGUsIHN0YXRlX3R5cGU9c3RhdGUudHlwZSwgY29sdW1uID0gc3RhdGUucG9zIC0gc3RhdGUubGluZVN0YXJ0XG4gIGlmIGNvbHVtbiAhPT0gc3RhY2tUb3AuaW5uZXJJbmRlbnQubGVuZ3RoIDo6XG4gICAgcmV0dXJuIG51bGwgLy8gbm90IGF0IHRoZSBleGFjdCByaWdodCBpbmRlbnRcbiAgaWYgc3RhY2tUb3AuZW5kID49IHN0YXRlLmVuZCA6OlxuICAgIHJldHVybiBmYWxzZSAvLyBubyBjb21tYSBiZWZvcmUgdGhlIGZpcnN0IGVsZW1lbnRcbiAgaWYgdHQuY29tbWEgPT09IHN0YXRlX3R5cGUgOjpcbiAgICByZXR1cm4gZmFsc2UgLy8gdGhlcmUncyBhbiBleHBsaWNpdCBjb21tYSBhbHJlYWR5IHByZXNlbnRcbiAgaWYgc3RhdGVfdHlwZS5iaW5vcCB8fCBzdGF0ZV90eXBlLmJlZm9yZUV4cHIgOjpcbiAgICByZXR1cm4gZmFsc2UgLy8gdGhlcmUncyBhbiBvcGVyYXRvciBvciBhcnJvdyBmdW5jdGlvbiBwcmVjZWVkaW5nIHRoaXMgbGluZVxuXG4gIGlmIHRoaXMuaXNMb29rYWhlYWQgOjogcmV0dXJuIGZhbHNlIC8vIGRpc2FsbG93IHJlY3Vyc2l2ZSBsb29rYWhlYWRcbiAgY29uc3Qge3R5cGU6IG5leHRfdHlwZX0gPSB0aGlzLmxvb2thaGVhZCgpXG5cbiAgaWYgdHRfb2Zmc2lkZV9kaXNydXB0X2ltcGxpY2l0X2NvbW1hLmhhcyhuZXh0X3R5cGUpIDo6XG4gICAgcmV0dXJuIGZhbHNlIC8vIHRoZXJlJ3MgYSBjb21tYSwgZG90LCBvciBmdW5jdGlvbiBhcnJvdyB0b2tlbiB0aGF0IHByZWNsdWRlcyBhbiBpbXBsaWNpdCBsZWFkaW5nIGNvbW1hXG4gIGlmIG5leHRfdHlwZS5iaW5vcCA6OlxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpbXBsaWNpdENvbW1hcy5oYXMgOjpcbiAgICAgIC8vIGFsbG93IGZvciB0dC5zdGFyIGluIGNlcnRhaW4gY29udGV4dHMg4oCUIGUuZy4gZm9yIGdlbmVyYXRvciBtZXRob2QgZGVmaW50aW9uc1xuICAgICAgcmV0dXJuIGltcGxpY2l0Q29tbWFzLmhhcyhuZXh0X3R5cGUpXG5cbiAgICByZXR1cm4gZmFsc2UgLy8gdGhlcmUncyBhIGJpbmFyeSBvcGVyYXRvciB0aGF0IHByZWNsdWRlcyBhbiBpbXBsaWNpdCBsZWFkaW5nIGNvbW1hXG4gIGVsc2UgOjpcbiAgICByZXR1cm4gdHJ1ZSAvLyBhbiBpbXBsaWNpdCBjb21tYSBpcyBuZWVkZWRcblxucHAuX2Jhc2VfcmVhZFRva2VuID0gYmFzZVByb3RvLnJlYWRUb2tlblxucHAucmVhZFRva2VuID0gZnVuY3Rpb24oY29kZSkgOjpcbiAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0YXRlXG5cbiAgaWYgc3RhdGUub2Zmc2lkZUltcGxpY2l0Q29tbWEgOjpcbiAgICByZXR1cm4gdGhpcy5fYmFzZV9maW5pc2hUb2tlbih0dC5jb21tYSlcblxuICBjb25zdCBvZmZzaWRlTmV4dE9wID0gc3RhdGUub2Zmc2lkZU5leHRPcFxuICBpZiBudWxsICE9PSBvZmZzaWRlTmV4dE9wIDo6XG4gICAgc3RhdGUub2Zmc2lkZU5leHRPcCA9IG51bGxcbiAgICByZXR1cm4gdGhpcy5maW5pc2hPZmZzaWRlT3Aob2Zmc2lkZU5leHRPcClcblxuICBpZiBzdGF0ZS5wb3MgPT09IHN0YXRlLm9mZnNpZGVQb3MgOjpcbiAgICByZXR1cm4gdGhpcy5wb3BPZmZzaWRlKClcblxuICByZXR1cm4gdGhpcy5fYmFzZV9yZWFkVG9rZW4oY29kZSlcblxucHAucG9wT2Zmc2lkZSA9IGZ1bmN0aW9uKCkgOjpcbiAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YXRlLm9mZnNpZGVcbiAgY29uc3Qgc3RhY2tUb3AgPSB0aGlzLmlzTG9va2FoZWFkXG4gICAgPyBzdGFja1tzdGFjay5sZW5ndGgtMV1cbiAgICA6IHN0YWNrLnBvcCgpXG4gIHRoaXMuc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG5cbiAgdGhpcy5fYmFzZV9maW5pc2hUb2tlbihzdGFja1RvcC5vcC50b2tlblBvc3QpXG4gIHJldHVybiBzdGFja1RvcFxuXG5cbnJldHVybiBQYXJzZXJcbn0gLy8gZW5kIHBlci1iYWJ5bG9uIGluc3RhbmNlIG1vbmtleXBhdGNoaW5nXG4iXX0=