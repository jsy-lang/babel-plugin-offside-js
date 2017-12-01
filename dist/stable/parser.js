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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL2NvZGUvcGFyc2VyLmpzIl0sIm5hbWVzIjpbImhvb2tCYWJ5bG9uIiwiaW5zdGFsbE9mZnNpZGVCYWJ5bG9uUGFyc2VycyIsImFzT2Zmc2lkZUpTQmFieWxvblBhcnNlciIsImJhYnlsb24iLCJQYXJzZXIiLCJ0Z3RfcGF0Y2giLCJ0b2tUeXBlcyIsImJyYWNlTCIsImZuX3VwZGF0ZUNvbnRleHQiLCJ1cGRhdGVDb250ZXh0IiwicHJldlR5cGUiLCJjb25zdHJ1Y3RvciIsInBhcnNlIiwiRXJyb3IiLCJob29rTGlzdCIsInB1c2giLCJyZXF1aXJlIiwiZXJyIiwibGVuZ3RoIiwibWFwIiwiYmFzZVByb3RvIiwicHJvdG90eXBlIiwicHAiLCJPYmplY3QiLCJjcmVhdGUiLCJ0dCIsImF0X29mZnNpZGUiLCJfZ19vZmZzaWRlUGx1Z2luT3B0cyIsIl9iYXNlX21vZHVsZV9wYXJzZSIsImlucHV0Iiwib3B0aW9ucyIsIm9mZnNpZGVQbHVnaW5PcHRzIiwidW5kZWZpbmVkIiwiX2Jhc2VfcGFyc2UiLCJpbml0T2Zmc2lkZSIsIk9mZnNpZGVCcmVha291dCIsIm9mZnNpZGVCcmVha291dCIsInN0YXRlIiwib2Zmc2lkZSIsIm9mZnNpZGVOZXh0T3AiLCJvZmZzaWRlX2xpbmVzIiwiX3BvcyIsInBvcyIsImRlZmluZVByb3BlcnR5IiwiZW51bWVyYWJsZSIsImdldCIsInNldCIsIm9mZlBvcyIsIm9mZnNpZGVQb3MiLCJ0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzIiwiU2V0IiwiX2lmIiwiX3doaWxlIiwiX2ZvciIsIl9jYXRjaCIsIl9zd2l0Y2giLCJ0dF9vZmZzaWRlX2tleXdvcmRfbG9va2FoZWFkX3NraXAiLCJwYXJlbkwiLCJjb2xvbiIsImNvbW1hIiwiZG90IiwiaXNGb3JBd2FpdCIsImtleXdvcmRUeXBlIiwidHlwZSIsInZhbCIsIm5hbWUiLCJyeF9vZmZzaWRlX29wIiwiX2Jhc2VfZmluaXNoVG9rZW4iLCJmaW5pc2hUb2tlbiIsInJlY2VudEtleXdvcmQiLCJvZmZzaWRlUmVjZW50S2V5d29yZCIsImluRm9yQXdhaXQiLCJoYXMiLCJpc0tleXdvcmRBbGxvd2VkIiwiaXNMb29rYWhlYWQiLCJsb29rYWhlYWQiLCJ2YWx1ZSIsImtleXdvcmRfYXJncyIsImF0IiwiZG91YmxlQ29sb24iLCJwb3MwIiwic3RhcnQiLCJwb3MxIiwibV9vcCIsImV4ZWMiLCJzbGljZSIsInN0cl9vcCIsImxpbmVFbmRzV2l0aE9wIiwib3AiLCJrZXl3b3JkQmxvY2siLCJuZXN0SW5uZXIiLCJfX3Byb3RvX18iLCJmaW5pc2hPZmZzaWRlT3AiLCJleHRyYUNoYXJzIiwibmVzdE9wIiwiZW9mIiwicG9wT2Zmc2lkZSIsIm9mZnNpZGVJbmRlbnQiLCJsaW5lMCIsIm91dGVySW5kZW50IiwiaW5uZXJJbmRlbnQiLCJpbm5lckxpbmUiLCJpbmRlbnQiLCJsaW5lIiwibGFzdCIsImN1ciIsImNvbnRlbnQiLCJvZmZzaWRlQmxvY2siLCJzdGFja1RvcCIsInJlY2VudEtleXdvcmRUb3AiLCJjdXJMaW5lIiwiZmlyc3QiLCJrZXl3b3JkTmVzdGVkSW5kZW50IiwiaW5LZXl3b3JkQXJnIiwiaW5kZW50X2Jsb2NrIiwiaW5kZW50X2tleXdvcmQiLCJwb3NMYXN0Q29udGVudCIsInN0YWNrIiwiaWR4IiwidGlwIiwiZW5kIiwibG9jIiwic3RhcnRMb2MiLCJlbmRMb2MiLCJjb2RlQmxvY2siLCJvZmZzaWRlUmVjZW50VG9wIiwidG9rZW5QcmUiLCJibGsiLCJfYmFzZV9za2lwU3BhY2UiLCJza2lwU3BhY2UiLCJvZmZzaWRlSW1wbGljaXRDb21tYSIsIm9mZnNpZGVDaGVja0ltcGxpY2l0Q29tbWEiLCJ0dF9vZmZzaWRlX2Rpc3J1cHRfaW1wbGljaXRfY29tbWEiLCJhcnJvdyIsInNlbWkiLCJxdWVzdGlvbiIsImltcGxpY2l0Q29tbWFzIiwiaW1wbGljaXRfY29tbWFzIiwic3RhdGVfdHlwZSIsImNvbHVtbiIsImxpbmVTdGFydCIsImJpbm9wIiwiYmVmb3JlRXhwciIsIm5leHRfdHlwZSIsIl9iYXNlX3JlYWRUb2tlbiIsInJlYWRUb2tlbiIsImNvZGUiLCJwb3AiLCJ0b2tlblBvc3QiXSwibWFwcGluZ3MiOiI7Ozs7O1FBRWdCQSxXLEdBQUFBLFc7UUFpQkFDLDRCLEdBQUFBLDRCO1FBc0JBQyx3QixHQUFBQSx3Qjs7QUF6Q2hCOztBQUVPLFNBQVNGLFdBQVQsQ0FBcUJHLE9BQXJCLEVBQThCO0FBQ25DO0FBQ0E7O0FBRUEsTUFBSUMsTUFBSjtBQUNBLFFBQU1DLFlBQVlGLFFBQVFHLFFBQVIsQ0FBaUJDLE1BQW5DO0FBQ0EsUUFBTUMsbUJBQW1CSCxVQUFVSSxhQUFuQztBQUNBSixZQUFVSSxhQUFWLEdBQTBCLFVBQVVDLFFBQVYsRUFBb0I7QUFDNUNMLGNBQVVJLGFBQVYsR0FBMEJELGdCQUExQjtBQUNBSixhQUFTLEtBQUtPLFdBQWQ7QUFBeUIsR0FGM0I7O0FBSUFSLFVBQVFTLEtBQVIsQ0FBYyxJQUFkO0FBQ0EsTUFBRyxDQUFFUixNQUFMLEVBQWM7QUFDWixVQUFNLElBQUlTLEtBQUosQ0FBWSwrQkFBWixDQUFOO0FBQWlEO0FBQ25ELFNBQU9ULE1BQVA7QUFBYSxDQUdSLFNBQVNILDRCQUFULEdBQXdDO0FBQzdDLFFBQU1hLFdBQVcsRUFBakI7O0FBRUEsTUFBSTtBQUFHQSxhQUFTQyxJQUFULENBQ0xDLFFBQVEsU0FBUixDQURLO0FBQ2EsR0FEcEIsQ0FFQSxPQUFNQyxHQUFOLEVBQVk7O0FBRVosTUFBSTtBQUFHSCxhQUFTQyxJQUFULENBQ0xDLFFBQVEsZ0NBQVIsQ0FESztBQUNvQyxHQUQzQyxDQUVBLE9BQU1DLEdBQU4sRUFBWTs7QUFFWixNQUFJO0FBQUdILGFBQVNDLElBQVQsQ0FDTEMsUUFBUSxpQ0FBUixDQURLO0FBQ3FDLEdBRDVDLENBRUEsT0FBTUMsR0FBTixFQUFZOztBQUVaLE1BQUcsTUFBTUgsU0FBU0ksTUFBbEIsRUFBMkI7QUFDekIsVUFBTSxJQUFJTCxLQUFKLENBQWEseUNBQWIsQ0FBTjtBQUEyRDs7QUFFN0QsU0FBT0MsU0FBU0ss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S21CLGlCQUFMLENBQXVCeUMsU0FBU3BCLEVBQVQsQ0FBWTRELFNBQW5DO0FBQ0EsV0FBT3hDLFFBQVA7QUFBZSxHQVJqQjs7QUFXQSxTQUFPeEcsTUFBUDtBQUNDLEMsQ0FBQyIsImZpbGUiOiJwYXJzZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge29mZnNpZGVPcGVyYXRvcnNGb3JCYWJ5bG9uLCBwYXJzZU9mZnNpZGVJbmRleE1hcH0gZnJvbSAnLi9vZmZzaWRlX29wcydcblxuZXhwb3J0IGZ1bmN0aW9uIGhvb2tCYWJ5bG9uKGJhYnlsb24pIDo6XG4gIC8vIGFidXNlIEJhYnlsb24gdG9rZW4gdXBkYXRlQ29udGV4dCBjYWxsYmFjayBleHRyYWN0XG4gIC8vIHRoZSByZWZlcmVuY2UgdG8gUGFyc2VyXG5cbiAgbGV0IFBhcnNlclxuICBjb25zdCB0Z3RfcGF0Y2ggPSBiYWJ5bG9uLnRva1R5cGVzLmJyYWNlTFxuICBjb25zdCBmbl91cGRhdGVDb250ZXh0ID0gdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHRcbiAgdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHQgPSBmdW5jdGlvbiAocHJldlR5cGUpIDo6XG4gICAgdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHQgPSBmbl91cGRhdGVDb250ZXh0XG4gICAgUGFyc2VyID0gdGhpcy5jb25zdHJ1Y3RvclxuXG4gIGJhYnlsb24ucGFyc2UoJ3t9JylcbiAgaWYgISBQYXJzZXIgOjpcbiAgICB0aHJvdyBuZXcgRXJyb3IgQCBcIkZhaWxlZCB0byBob29rIEJhYnlsb24gUGFyc2VyXCJcbiAgcmV0dXJuIFBhcnNlclxuXG5cbmV4cG9ydCBmdW5jdGlvbiBpbnN0YWxsT2Zmc2lkZUJhYnlsb25QYXJzZXJzKCkgOjpcbiAgY29uc3QgaG9va0xpc3QgPSBbXVxuXG4gIHRyeSA6OiBob29rTGlzdC5wdXNoIEBcbiAgICByZXF1aXJlKCdiYWJ5bG9uJylcbiAgY2F0Y2ggZXJyIDo6XG5cbiAgdHJ5IDo6IGhvb2tMaXN0LnB1c2ggQFxuICAgIHJlcXVpcmUoJ2JhYmVsLWNsaS9ub2RlX21vZHVsZXMvYmFieWxvbicpXG4gIGNhdGNoIGVyciA6OlxuXG4gIHRyeSA6OiBob29rTGlzdC5wdXNoIEBcbiAgICByZXF1aXJlKCdiYWJlbC1jb3JlL25vZGVfbW9kdWxlcy9iYWJ5bG9uJylcbiAgY2F0Y2ggZXJyIDo6XG5cbiAgaWYgMCA9PT0gaG9va0xpc3QubGVuZ3RoIDo6XG4gICAgdGhyb3cgbmV3IEVycm9yIEAgYFVuYWJsZSB0byBsb2FkIFwiYmFieWxvblwiIHBhcnNlciBwYWNrYWdlYFxuXG4gIHJldHVybiBob29rTGlzdC5tYXAgQCBiYWJ5bG9uID0+XG4gICAgYXNPZmZzaWRlSlNCYWJ5bG9uUGFyc2VyKGJhYnlsb24pXG4gIFxuXG5leHBvcnQgZnVuY3Rpb24gYXNPZmZzaWRlSlNCYWJ5bG9uUGFyc2VyKGJhYnlsb24pXG57IC8vIGJlZ2luIHBlci1iYWJ5bG9uIGluc3RhbmNlIG1vbmtleXBhdGNoaW5nXG5cbmNvbnN0IFBhcnNlciA9IGhvb2tCYWJ5bG9uKGJhYnlsb24pXG5jb25zdCBiYXNlUHJvdG8gPSBQYXJzZXIucHJvdG90eXBlXG5jb25zdCBwcCA9IFBhcnNlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKGJhc2VQcm90bylcbmNvbnN0IHR0ID0gYmFieWxvbi50b2tUeXBlc1xuXG5jb25zdCBhdF9vZmZzaWRlID0gb2Zmc2lkZU9wZXJhdG9yc0ZvckJhYnlsb24odHQpXG5cbnZhciBfZ19vZmZzaWRlUGx1Z2luT3B0c1xuXG5jb25zdCBfYmFzZV9tb2R1bGVfcGFyc2UgPSBiYWJ5bG9uLnBhcnNlXG5iYWJ5bG9uLnBhcnNlID0gKGlucHV0LCBvcHRpb25zKSA9PiA6OlxuICBfZ19vZmZzaWRlUGx1Z2luT3B0cyA9IG9wdGlvbnMgPyBvcHRpb25zLm9mZnNpZGVQbHVnaW5PcHRzIDogdW5kZWZpbmVkXG4gIHJldHVybiBfYmFzZV9tb2R1bGVfcGFyc2UoaW5wdXQsIG9wdGlvbnMpXG5cblxucHAuX2Jhc2VfcGFyc2UgPSBiYXNlUHJvdG8ucGFyc2VcbnBwLnBhcnNlID0gZnVuY3Rpb24oKSA6OlxuICB0aGlzLmluaXRPZmZzaWRlKClcbiAgcmV0dXJuIHRoaXMuX2Jhc2VfcGFyc2UoKVxuXG5cbmNsYXNzIE9mZnNpZGVCcmVha291dCBleHRlbmRzIEVycm9yIHt9XG5jb25zdCBvZmZzaWRlQnJlYWtvdXQgPSBuZXcgT2Zmc2lkZUJyZWFrb3V0KClcblxucHAuaW5pdE9mZnNpZGUgPSBmdW5jdGlvbigpIDo6XG4gIHRoaXMuc3RhdGUub2Zmc2lkZSA9IFtdXG4gIHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCA9IG51bGxcbiAgdGhpcy5vZmZzaWRlX2xpbmVzID0gcGFyc2VPZmZzaWRlSW5kZXhNYXAodGhpcy5pbnB1dClcbiAgdGhpcy5vZmZzaWRlUGx1Z2luT3B0cyA9IF9nX29mZnNpZGVQbHVnaW5PcHRzIHx8IHt9XG4gIF9nX29mZnNpZGVQbHVnaW5PcHRzID0gbnVsbFxuXG4gIHRoaXMuc3RhdGUuX3BvcyA9IHRoaXMuc3RhdGUucG9zXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIHRoaXMuc3RhdGUsICdwb3MnLCBAe31cbiAgICBlbnVtZXJhYmxlOiB0cnVlXG4gICAgZ2V0KCkgOjogcmV0dXJuIHRoaXMuX3Bvc1xuICAgIHNldChwb3MpIDo6XG4gICAgICAvLyBpbnRlcnJ1cHQgc2tpcFNwYWNlIGFsZ29yaXRobSB3aGVuIHdlIGhpdCBvdXIgcG9zaXRpb24gJ2JyZWFrcG9pbnQnXG4gICAgICBjb25zdCBvZmZQb3MgPSB0aGlzLm9mZnNpZGVQb3NcbiAgICAgIGlmIG9mZlBvcz49MCAmJiAocG9zID4gb2ZmUG9zKSA6OlxuICAgICAgICB0aHJvdyBvZmZzaWRlQnJlYWtvdXRcblxuICAgICAgdGhpcy5fcG9zID0gcG9zXG5cblxuY29uc3QgdHRfb2Zmc2lkZV9rZXl3b3JkX3dpdGhfYXJncyA9IG5ldyBTZXQgQCNcbiAgICAgIHR0Ll9pZiwgdHQuX3doaWxlLCB0dC5fZm9yXG4gICAgICB0dC5fY2F0Y2gsIHR0Ll9zd2l0Y2hcblxuY29uc3QgdHRfb2Zmc2lkZV9rZXl3b3JkX2xvb2thaGVhZF9za2lwID0gbmV3IFNldCBAI1xuICAgICAgdHQucGFyZW5MLCB0dC5jb2xvbiwgdHQuY29tbWEsIHR0LmRvdFxuXG5wcC5pc0ZvckF3YWl0ID0gZnVuY3Rpb24gKGtleXdvcmRUeXBlLCB0eXBlLCB2YWwpIDo6XG4gIHJldHVybiB0dC5fZm9yID09PSBrZXl3b3JkVHlwZVxuICAgICYmIHR0Lm5hbWUgPT09IHR5cGVcbiAgICAmJiAnYXdhaXQnID09PSB2YWxcblxuY29uc3Qgcnhfb2Zmc2lkZV9vcCA9IC8oXFxTKylbIFxcdF0qKFxcclxcbnxcXHJ8XFxuKT8vXG5cbnBwLl9iYXNlX2ZpbmlzaFRva2VuID0gYmFzZVByb3RvLmZpbmlzaFRva2VuXG5wcC5maW5pc2hUb2tlbiA9IGZ1bmN0aW9uKHR5cGUsIHZhbCkgOjpcbiAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0YXRlXG4gIGNvbnN0IHJlY2VudEtleXdvcmQgPSBzdGF0ZS5vZmZzaWRlUmVjZW50S2V5d29yZFxuICBjb25zdCBpbkZvckF3YWl0ID0gcmVjZW50S2V5d29yZCA/IHRoaXMuaXNGb3JBd2FpdChyZWNlbnRLZXl3b3JkLCB0eXBlLCB2YWwpIDogbnVsbFxuICBzdGF0ZS5vZmZzaWRlUmVjZW50S2V5d29yZCA9IG51bGxcblxuICBpZiB0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzLmhhcyh0eXBlKSB8fCBpbkZvckF3YWl0IDo6XG4gICAgY29uc3QgaXNLZXl3b3JkQWxsb3dlZCA9ICF0aGlzLmlzTG9va2FoZWFkXG4gICAgICAmJiB0dC5kb3QgIT09IHN0YXRlLnR5cGVcblxuICAgIGlmICFpc0tleXdvcmRBbGxvd2VkIDo6XG4gICAgICByZXR1cm4gdGhpcy5fYmFzZV9maW5pc2hUb2tlbih0eXBlLCB2YWwpXG5cbiAgICBzdGF0ZS5vZmZzaWRlUmVjZW50S2V5d29yZCA9IGluRm9yQXdhaXQgPyB0dC5fZm9yIDogdHlwZVxuICAgIGNvbnN0IGxvb2thaGVhZCA9IHRoaXMubG9va2FoZWFkKClcblxuICAgIGlmIHR0X29mZnNpZGVfa2V5d29yZF9sb29rYWhlYWRfc2tpcC5oYXMobG9va2FoZWFkLnR5cGUpIDo6XG4gICAgZWxzZSBpZiB0aGlzLmlzRm9yQXdhaXQodHlwZSwgbG9va2FoZWFkLnR5cGUsIGxvb2thaGVhZC52YWx1ZSkgOjpcbiAgICBlbHNlIDo6XG4gICAgICBzdGF0ZS5vZmZzaWRlTmV4dE9wID0gYXRfb2Zmc2lkZS5rZXl3b3JkX2FyZ3NcblxuICAgIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR5cGUsIHZhbClcblxuICBpZiB0eXBlID09PSB0dC5hdCB8fCB0eXBlID09PSB0dC5kb3VibGVDb2xvbiA6OlxuICAgIGNvbnN0IHBvczAgPSBzdGF0ZS5zdGFydCwgcG9zMSA9IHN0YXRlLnBvcyArIDJcbiAgICBjb25zdCBtX29wID0gcnhfb2Zmc2lkZV9vcC5leGVjIEAgdGhpcy5pbnB1dC5zbGljZShwb3MwKVxuICAgIGNvbnN0IHN0cl9vcCA9IG1fb3BbMV1cbiAgICBjb25zdCBsaW5lRW5kc1dpdGhPcCA9ICEhIG1fb3BbMl1cblxuICAgIGxldCBvcCA9IGF0X29mZnNpZGVbc3RyX29wXVxuICAgIGlmIG9wIDo6XG4gICAgICBpZiBvcC5rZXl3b3JkQmxvY2sgJiYgcmVjZW50S2V5d29yZCAmJiB0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzLmhhcyhyZWNlbnRLZXl3b3JkKSA6OlxuICAgICAgICBvcCA9IGF0X29mZnNpZGUua2V5d29yZF9hcmdzXG5cbiAgICAgIGVsc2UgaWYgbGluZUVuZHNXaXRoT3AgJiYgb3AubmVzdElubmVyOjpcbiAgICAgICAgLy8gYWxsIG9mZnNpZGUgb3BlcmF0b3JzIGF0IHRoZSBlbmQgb2YgYSBsaW5lIGltcGxpY2l0bHkgZG9uJ3QgbmVzdElubmVyXG4gICAgICAgIG9wID0gQHt9IF9fcHJvdG9fXzogb3AsIG5lc3RJbm5lcjogZmFsc2VcblxuICAgICAgdGhpcy5maW5pc2hPZmZzaWRlT3Aob3AsIG9wLmV4dHJhQ2hhcnMpXG5cbiAgICAgIGlmIG9wLm5lc3RPcCA6OlxuICAgICAgICBzdGF0ZS5vZmZzaWRlTmV4dE9wID0gYXRfb2Zmc2lkZVtvcC5uZXN0T3BdXG4gICAgICByZXR1cm5cblxuICBpZiB0dC5lb2YgPT09IHR5cGUgOjpcbiAgICBpZiBzdGF0ZS5vZmZzaWRlLmxlbmd0aCA6OlxuICAgICAgcmV0dXJuIHRoaXMucG9wT2Zmc2lkZSgpXG5cbiAgcmV0dXJuIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4odHlwZSwgdmFsKVxuXG5cbnBwLm9mZnNpZGVJbmRlbnQgPSBmdW5jdGlvbiAobGluZTAsIG91dGVySW5kZW50LCBpbm5lckluZGVudCkgOjpcbiAgY29uc3Qgb2Zmc2lkZV9saW5lcyA9IHRoaXMub2Zmc2lkZV9saW5lc1xuXG4gIGlmIG51bGwgPT0gaW5uZXJJbmRlbnQgOjpcbiAgICBjb25zdCBpbm5lckxpbmUgPSBvZmZzaWRlX2xpbmVzW2xpbmUwKzFdXG4gICAgaW5uZXJJbmRlbnQgPSBpbm5lckxpbmUgPyBpbm5lckxpbmUuaW5kZW50IDogJydcblxuICBsZXQgbGluZT1saW5lMCsxLCBsYXN0PW9mZnNpZGVfbGluZXNbbGluZTBdXG4gIHdoaWxlIGxpbmUgPCBvZmZzaWRlX2xpbmVzLmxlbmd0aCA6OlxuICAgIGNvbnN0IGN1ciA9IG9mZnNpZGVfbGluZXNbbGluZV1cbiAgICBpZiBjdXIuY29udGVudCAmJiBvdXRlckluZGVudCA+PSBjdXIuaW5kZW50IDo6XG4gICAgICBsaW5lLS0gLy8gYmFja3VwIHRvIHByZXZpb3VzIGxpbmVcbiAgICAgIGJyZWFrXG5cbiAgICBsaW5lKys7IGxhc3QgPSBjdXJcbiAgICBpZiBpbm5lckluZGVudCA+IGN1ci5pbmRlbnQgOjpcbiAgICAgIGlubmVySW5kZW50ID0gY3VyLmluZGVudFxuXG4gIHJldHVybiBAe30gbGluZSwgbGFzdCwgaW5uZXJJbmRlbnRcblxuXG5wcC5vZmZzaWRlQmxvY2sgPSBmdW5jdGlvbiAob3AsIHN0YWNrVG9wLCByZWNlbnRLZXl3b3JkVG9wKSA6OlxuICBjb25zdCBzdGF0ZSA9IHRoaXMuc3RhdGVcbiAgY29uc3QgbGluZTAgPSBzdGF0ZS5jdXJMaW5lXG4gIGNvbnN0IGZpcnN0ID0gdGhpcy5vZmZzaWRlX2xpbmVzW2xpbmUwXVxuXG4gIGxldCBpbmRlbnQsIGtleXdvcmROZXN0ZWRJbmRlbnRcbiAgaWYgcmVjZW50S2V5d29yZFRvcCA6OlxuICAgIGluZGVudCA9IHJlY2VudEtleXdvcmRUb3AuZmlyc3QuaW5kZW50XG4gIGVsc2UgaWYgb3AubmVzdElubmVyICYmIHN0YWNrVG9wICYmIGxpbmUwID09PSBzdGFja1RvcC5maXJzdC5saW5lIDo6XG4gICAgaW5kZW50ID0gc3RhY2tUb3AuaW5uZXJJbmRlbnRcbiAgZWxzZSBpZiBvcC5pbktleXdvcmRBcmcgOjpcbiAgICBpbmRlbnQgPSBmaXJzdC5pbmRlbnRcbiAgICBjb25zdCBpbmRlbnRfYmxvY2sgPSB0aGlzLm9mZnNpZGVJbmRlbnQobGluZTAsIGluZGVudClcbiAgICBjb25zdCBpbmRlbnRfa2V5d29yZCA9IHRoaXMub2Zmc2lkZUluZGVudChsaW5lMCwgaW5kZW50X2Jsb2NrLmlubmVySW5kZW50KVxuICAgIGlmIGluZGVudF9rZXl3b3JkLmlubmVySW5kZW50ID4gaW5kZW50X2Jsb2NrLmlubmVySW5kZW50IDo6XG4gICAgICAvLyBhdXRvZGV0ZWN0IGtleXdvcmQgYXJndW1lbnQgdXNpbmcgJ0AnIGZvciBmdW5jdGlvbiBjYWxsc1xuICAgICAgaW5kZW50ID0gaW5kZW50X2Jsb2NrLmlubmVySW5kZW50XG4gICAgICBrZXl3b3JkTmVzdGVkSW5kZW50ID0gaW5kZW50X2tleXdvcmQuaW5uZXJJbmRlbnRcbiAgZWxzZSA6OlxuICAgIGluZGVudCA9IGZpcnN0LmluZGVudFxuXG4gIGxldCB7bGFzdCwgaW5uZXJJbmRlbnR9ID0gdGhpcy5vZmZzaWRlSW5kZW50KGxpbmUwLCBpbmRlbnQsIGtleXdvcmROZXN0ZWRJbmRlbnQpXG5cbiAgLy8gY2FwIHRvIFxuICBpbm5lckluZGVudCA9IGZpcnN0LmluZGVudCA+IGlubmVySW5kZW50XG4gICAgPyBmaXJzdC5pbmRlbnQgOiBpbm5lckluZGVudFxuXG4gIGlmIHN0YWNrVG9wICYmIHN0YWNrVG9wLmxhc3QucG9zTGFzdENvbnRlbnQgPCBsYXN0LnBvc0xhc3RDb250ZW50OjpcbiAgICAvLyBGaXh1cCBlbmNsb3Npbmcgc2NvcGVzLiBIYXBwZW5zIGluIHNpdHVhdGlvbnMgbGlrZTogYHNlcnZlci5vbiBAIHdyYXBlciBAICguLi5hcmdzKSA9PiA6OmBcbiAgICBjb25zdCBzdGFjayA9IHN0YXRlLm9mZnNpZGVcbiAgICBmb3IgbGV0IGlkeCA9IHN0YWNrLmxlbmd0aC0xOyBpZHg+MDsgaWR4LS0gOjpcbiAgICAgIGxldCB0aXAgPSBzdGFja1tpZHhdXG4gICAgICBpZiB0aXAubGFzdC5wb3NMYXN0Q29udGVudCA+PSBsYXN0LnBvc0xhc3RDb250ZW50IDo6IGJyZWFrXG4gICAgICB0aXAubGFzdCA9IGxhc3RcblxuICByZXR1cm4gQHt9IG9wLCBpbm5lckluZGVudCwgZmlyc3QsIGxhc3RcbiAgICAgIHN0YXJ0OiBzdGF0ZS5zdGFydCwgZW5kOiBzdGF0ZS5lbmRcbiAgICAgIGxvYzogQHt9IHN0YXJ0OiBzdGF0ZS5zdGFydExvYywgZW5kOiBzdGF0ZS5lbmRMb2NcblxuXG5cbnBwLmZpbmlzaE9mZnNpZGVPcCA9IGZ1bmN0aW9uIChvcCwgZXh0cmFDaGFycykgOjpcbiAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YXRlLm9mZnNpZGVcbiAgbGV0IHN0YWNrVG9wID0gc3RhY2tbc3RhY2subGVuZ3RoIC0gMV1cbiAgbGV0IHJlY2VudEtleXdvcmRUb3BcbiAgaWYgb3AuY29kZUJsb2NrIDo6XG4gICAgaWYgc3RhY2tUb3AgJiYgc3RhY2tUb3AuaW5LZXl3b3JkQXJnIDo6XG4gICAgICAvLyBXZSdyZSBhdCB0aGUgZW5kIG9mIGFuIG9mZnNpZGUga2V5d29yZCBibG9jazsgcmVzdG9yZSBlbmNsb3NpbmcgKClcbiAgICAgIHRoaXMucG9wT2Zmc2lkZSgpXG4gICAgICB0aGlzLnN0YXRlLm9mZnNpZGVOZXh0T3AgPSBvcFxuICAgICAgdGhpcy5zdGF0ZS5vZmZzaWRlUmVjZW50VG9wID0gc3RhY2tUb3BcbiAgICAgIHJldHVyblxuXG4gICAgcmVjZW50S2V5d29yZFRvcCA9IHRoaXMuc3RhdGUub2Zmc2lkZVJlY2VudFRvcFxuICAgIHRoaXMuc3RhdGUub2Zmc2lkZVJlY2VudFRvcCA9IG51bGxcblxuICBpZiBleHRyYUNoYXJzIDo6XG4gICAgdGhpcy5zdGF0ZS5wb3MgKz0gZXh0cmFDaGFyc1xuXG4gIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4ob3AudG9rZW5QcmUpXG5cbiAgaWYgdGhpcy5pc0xvb2thaGVhZCA6OiByZXR1cm5cblxuICBzdGFja1RvcCA9IHN0YWNrW3N0YWNrLmxlbmd0aCAtIDFdXG4gIGNvbnN0IGJsayA9IHRoaXMub2Zmc2lkZUJsb2NrKG9wLCBzdGFja1RvcCwgcmVjZW50S2V5d29yZFRvcClcbiAgYmxrLmluS2V5d29yZEFyZyA9IG9wLmluS2V5d29yZEFyZyB8fCBzdGFja1RvcCAmJiBzdGFja1RvcC5pbktleXdvcmRBcmdcbiAgdGhpcy5zdGF0ZS5vZmZzaWRlLnB1c2goYmxrKVxuXG5cbnBwLl9iYXNlX3NraXBTcGFjZSA9IGJhc2VQcm90by5za2lwU3BhY2VcbnBwLnNraXBTcGFjZSA9IGZ1bmN0aW9uKCkgOjpcbiAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0YXRlXG4gIGlmIG51bGwgIT09IHN0YXRlLm9mZnNpZGVOZXh0T3AgOjogcmV0dXJuXG5cbiAgY29uc3Qgc3RhY2sgPSBzdGF0ZS5vZmZzaWRlXG4gIGxldCBzdGFja1RvcFxuICBpZiBzdGFjayAmJiBzdGFjay5sZW5ndGggOjpcbiAgICBzdGFja1RvcCA9IHN0YWNrW3N0YWNrLmxlbmd0aC0xXVxuICAgIHN0YXRlLm9mZnNpZGVQb3MgPSBzdGFja1RvcC5sYXN0LnBvc0xhc3RDb250ZW50XG4gIGVsc2UgOjogc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG5cbiAgdHJ5IDo6XG4gICAgdGhpcy5fYmFzZV9za2lwU3BhY2UoKVxuICAgIHN0YXRlLm9mZnNpZGVQb3MgPSAtMVxuXG4gICAgc3RhdGUub2Zmc2lkZUltcGxpY2l0Q29tbWEgPSB1bmRlZmluZWQgIT09IHN0YWNrVG9wXG4gICAgICA/IHRoaXMub2Zmc2lkZUNoZWNrSW1wbGljaXRDb21tYShzdGFja1RvcClcbiAgICAgIDogbnVsbFxuICBjYXRjaCBlcnIgOjpcbiAgICBpZiBlcnIgIT09IG9mZnNpZGVCcmVha291dCA6OiB0aHJvdyBlcnJcblxuXG5jb25zdCB0dF9vZmZzaWRlX2Rpc3J1cHRfaW1wbGljaXRfY29tbWEgPSBuZXcgU2V0IEAjXG4gIHR0LmNvbW1hLCB0dC5kb3QsIHR0LmFycm93LCB0dC5jb2xvbiwgdHQuc2VtaSwgdHQucXVlc3Rpb25cblxucHAub2Zmc2lkZUNoZWNrSW1wbGljaXRDb21tYSA9IGZ1bmN0aW9uKHN0YWNrVG9wKSA6OlxuICBjb25zdCB7aW1wbGljaXRDb21tYXN9ID0gc3RhY2tUb3Aub3BcbiAgaWYgISBpbXBsaWNpdENvbW1hcyA6OlxuICAgIHJldHVybiBudWxsIC8vIG5vdCBlbmFibGVkIGZvciB0aGlzIG9mZnNpZGUgb3BcbiAgaWYgISB0aGlzLm9mZnNpZGVQbHVnaW5PcHRzLmltcGxpY2l0X2NvbW1hcyA6OlxuICAgIHJldHVybiBudWxsIC8vIG5vdCBlbmFibGVkIGZvciB0aGlzIG9mZnNpZGUgb3BcblxuICBjb25zdCBzdGF0ZSA9IHRoaXMuc3RhdGUsIHN0YXRlX3R5cGU9c3RhdGUudHlwZSwgY29sdW1uID0gc3RhdGUucG9zIC0gc3RhdGUubGluZVN0YXJ0XG4gIGlmIGNvbHVtbiAhPT0gc3RhY2tUb3AuaW5uZXJJbmRlbnQubGVuZ3RoIDo6XG4gICAgcmV0dXJuIG51bGwgLy8gbm90IGF0IHRoZSBleGFjdCByaWdodCBpbmRlbnRcbiAgaWYgc3RhY2tUb3AuZW5kID49IHN0YXRlLmVuZCA6OlxuICAgIHJldHVybiBmYWxzZSAvLyBubyBjb21tYSBiZWZvcmUgdGhlIGZpcnN0IGVsZW1lbnRcbiAgaWYgdHQuY29tbWEgPT09IHN0YXRlX3R5cGUgOjpcbiAgICByZXR1cm4gZmFsc2UgLy8gdGhlcmUncyBhbiBleHBsaWNpdCBjb21tYSBhbHJlYWR5IHByZXNlbnRcbiAgaWYgc3RhdGVfdHlwZS5iaW5vcCB8fCBzdGF0ZV90eXBlLmJlZm9yZUV4cHIgOjpcbiAgICByZXR1cm4gZmFsc2UgLy8gdGhlcmUncyBhbiBvcGVyYXRvciBvciBhcnJvdyBmdW5jdGlvbiBwcmVjZWVkaW5nIHRoaXMgbGluZVxuXG4gIGlmIHRoaXMuaXNMb29rYWhlYWQgOjogcmV0dXJuIGZhbHNlIC8vIGRpc2FsbG93IHJlY3Vyc2l2ZSBsb29rYWhlYWRcbiAgY29uc3Qge3R5cGU6IG5leHRfdHlwZX0gPSB0aGlzLmxvb2thaGVhZCgpXG5cbiAgaWYgdHRfb2Zmc2lkZV9kaXNydXB0X2ltcGxpY2l0X2NvbW1hLmhhcyhuZXh0X3R5cGUpIDo6XG4gICAgcmV0dXJuIGZhbHNlIC8vIHRoZXJlJ3MgYSBjb21tYSwgZG90LCBvciBmdW5jdGlvbiBhcnJvdyB0b2tlbiB0aGF0IHByZWNsdWRlcyBhbiBpbXBsaWNpdCBsZWFkaW5nIGNvbW1hXG4gIGlmIG5leHRfdHlwZS5iaW5vcCA6OlxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpbXBsaWNpdENvbW1hcy5oYXMgOjpcbiAgICAgIC8vIGFsbG93IGZvciB0dC5zdGFyIGluIGNlcnRhaW4gY29udGV4dHMg4oCUIGUuZy4gZm9yIGdlbmVyYXRvciBtZXRob2QgZGVmaW50aW9uc1xuICAgICAgcmV0dXJuIGltcGxpY2l0Q29tbWFzLmhhcyhuZXh0X3R5cGUpXG5cbiAgICByZXR1cm4gZmFsc2UgLy8gdGhlcmUncyBhIGJpbmFyeSBvcGVyYXRvciB0aGF0IHByZWNsdWRlcyBhbiBpbXBsaWNpdCBsZWFkaW5nIGNvbW1hXG4gIGVsc2UgOjpcbiAgICByZXR1cm4gdHJ1ZSAvLyBhbiBpbXBsaWNpdCBjb21tYSBpcyBuZWVkZWRcblxucHAuX2Jhc2VfcmVhZFRva2VuID0gYmFzZVByb3RvLnJlYWRUb2tlblxucHAucmVhZFRva2VuID0gZnVuY3Rpb24oY29kZSkgOjpcbiAgY29uc3Qgc3RhdGUgPSB0aGlzLnN0YXRlXG5cbiAgaWYgc3RhdGUub2Zmc2lkZUltcGxpY2l0Q29tbWEgOjpcbiAgICByZXR1cm4gdGhpcy5fYmFzZV9maW5pc2hUb2tlbih0dC5jb21tYSlcblxuICBjb25zdCBvZmZzaWRlTmV4dE9wID0gc3RhdGUub2Zmc2lkZU5leHRPcFxuICBpZiBudWxsICE9PSBvZmZzaWRlTmV4dE9wIDo6XG4gICAgc3RhdGUub2Zmc2lkZU5leHRPcCA9IG51bGxcbiAgICByZXR1cm4gdGhpcy5maW5pc2hPZmZzaWRlT3Aob2Zmc2lkZU5leHRPcClcblxuICBpZiBzdGF0ZS5wb3MgPT09IHN0YXRlLm9mZnNpZGVQb3MgOjpcbiAgICByZXR1cm4gdGhpcy5wb3BPZmZzaWRlKClcblxuICByZXR1cm4gdGhpcy5fYmFzZV9yZWFkVG9rZW4oY29kZSlcblxucHAucG9wT2Zmc2lkZSA9IGZ1bmN0aW9uKCkgOjpcbiAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YXRlLm9mZnNpZGVcbiAgY29uc3Qgc3RhY2tUb3AgPSB0aGlzLmlzTG9va2FoZWFkXG4gICAgPyBzdGFja1tzdGFjay5sZW5ndGgtMV1cbiAgICA6IHN0YWNrLnBvcCgpXG4gIHRoaXMuc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG5cbiAgdGhpcy5fYmFzZV9maW5pc2hUb2tlbihzdGFja1RvcC5vcC50b2tlblBvc3QpXG4gIHJldHVybiBzdGFja1RvcFxuXG5cbnJldHVybiBQYXJzZXJcbn0gLy8gZW5kIHBlci1iYWJ5bG9uIGluc3RhbmNlIG1vbmtleXBhdGNoaW5nXG4iXX0=