'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.offsideOperatorsForBabylon = offsideOperatorsForBabylon;
exports.parseOffsideIndexMap = parseOffsideIndexMap;
function offsideOperatorsForBabylon(tokTypes) {
  const tt = tokTypes;

  const implicitCommaContext = {
    objectLiteral: new Set([tt.star // allow generator defintions with implicit commas
    ]) };

  const at_offside = {
    '::': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: false, codeBlock: true, implicitCommas: false },
    '::@': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, extraChars: 1, implicitCommas: false },
    '::()': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, extraChars: 2, implicitCommas: false },
    '::{}': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: false, extraChars: 2, implicitCommas: false },
    '::[]': { tokenPre: tt.bracketL, tokenPost: tt.bracketR, nestInner: false, extraChars: 2, implicitCommas: false },

    '@': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: true, keywordBlock: true, implicitCommas: true },
    '@:': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: true, extraChars: 1, nestOp: '\0{,}', implicitCommas: implicitCommaContext.objectLiteral },
    '@#': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: true, extraChars: 1, nestOp: '\0[,]', implicitCommas: true },

    '@()': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: true, extraChars: 2, implicitCommas: true },
    '@{}': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: true, extraChars: 2, implicitCommas: implicitCommaContext.objectLiteral },
    '@[]': { tokenPre: tt.bracketL, tokenPost: tt.bracketR, nestInner: true, extraChars: 2, implicitCommas: true },

    '@=>>': { tokenPre: [tt.parenL, 'async', tt.parenL, tt.parenR, tt.arrow], tokenPost: tt.parenR, nestInner: true, extraChars: 3, implicitCommas: false },
    '@=>': { tokenPre: [tt.parenL, tt.parenL, tt.parenR, tt.arrow], tokenPost: tt.parenR, nestInner: true, extraChars: 2, implicitCommas: false

      // note:  no '@()' -- standardize to use single-char '@ ' instead
    }, keyword_args: { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, inKeywordArg: true, implicitCommas: false

      // synthetic nestOp delegate operations
    }, '\0{,}': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: false, implicitCommas: implicitCommaContext.objectLiteral },
    '\0[,]': { tokenPre: tt.bracketL, tokenPost: tt.bracketR, nestInner: false, implicitCommas: true } };

  Object.entries(at_offside).forEach(([name, opRec]) => Object.assign(opRec, { name }));
  return at_offside;
}

const rx_offside = /^([ \t]*)(.*)$/mg;
function parseOffsideIndexMap(input) {
  let lines = [null],
      posLastContent = 0,
      last = ['', 0];
  let idx_lastContent = 0;

  input.replace(rx_offside, (match, indent, content, pos) => {
    if (!content) {
      posLastContent = last;
      indent = false;
    } else {
      // valid content; set last to current indent
      posLastContent = pos + match.length;
      idx_lastContent = lines.length;
      last = posLastContent;
    }
    lines.push({ line: lines.length, posFirstContent: pos, posLastContent, indent, content });
    return '';
  });

  lines.splice(1 + idx_lastContent); // trim trailing whitespace
  return lines;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL2NvZGUvb2Zmc2lkZV9vcHMuanMiXSwibmFtZXMiOlsib2Zmc2lkZU9wZXJhdG9yc0ZvckJhYnlsb24iLCJwYXJzZU9mZnNpZGVJbmRleE1hcCIsInRva1R5cGVzIiwidHQiLCJpbXBsaWNpdENvbW1hQ29udGV4dCIsIm9iamVjdExpdGVyYWwiLCJTZXQiLCJzdGFyIiwiYXRfb2Zmc2lkZSIsInRva2VuUHJlIiwiYnJhY2VMIiwidG9rZW5Qb3N0IiwiYnJhY2VSIiwibmVzdElubmVyIiwiY29kZUJsb2NrIiwiaW1wbGljaXRDb21tYXMiLCJwYXJlbkwiLCJwYXJlblIiLCJleHRyYUNoYXJzIiwiYnJhY2tldEwiLCJicmFja2V0UiIsImtleXdvcmRCbG9jayIsIm5lc3RPcCIsImFycm93Iiwia2V5d29yZF9hcmdzIiwiaW5LZXl3b3JkQXJnIiwiT2JqZWN0IiwiZW50cmllcyIsImZvckVhY2giLCJuYW1lIiwib3BSZWMiLCJhc3NpZ24iLCJyeF9vZmZzaWRlIiwiaW5wdXQiLCJsaW5lcyIsInBvc0xhc3RDb250ZW50IiwibGFzdCIsImlkeF9sYXN0Q29udGVudCIsInJlcGxhY2UiLCJtYXRjaCIsImluZGVudCIsImNvbnRlbnQiLCJwb3MiLCJsZW5ndGgiLCJwdXNoIiwibGluZSIsInBvc0ZpcnN0Q29udGVudCIsInNwbGljZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7UUFDZ0JBLDBCLEdBQUFBLDBCO1FBc0NBQyxvQixHQUFBQSxvQjtBQXRDVCxTQUFTRCwwQkFBVCxDQUFvQ0UsUUFBcEMsRUFBOEM7QUFDbkQsUUFBTUMsS0FBS0QsUUFBWDs7QUFFQSxRQUFNRSx1QkFBeUI7QUFDN0JDLG1CQUFlLElBQUlDLEdBQUosQ0FBVSxDQUN2QkgsR0FBR0ksSUFEb0IsQ0FDZjtBQURlLEtBQVYsQ0FEYyxFQUEvQjs7QUFJQSxRQUFNQyxhQUFhO0FBQ2pCLFVBQVEsRUFBSUMsVUFBVU4sR0FBR08sTUFBakIsRUFBeUJDLFdBQVdSLEdBQUdTLE1BQXZDLEVBQStDQyxXQUFXLEtBQTFELEVBQWlFQyxXQUFXLElBQTVFLEVBQWtGQyxnQkFBZ0IsS0FBbEcsRUFEUztBQUVqQixXQUFRLEVBQUlOLFVBQVVOLEdBQUdhLE1BQWpCLEVBQXlCTCxXQUFXUixHQUFHYyxNQUF2QyxFQUErQ0osV0FBVyxLQUExRCxFQUFpRUssWUFBWSxDQUE3RSxFQUFnRkgsZ0JBQWdCLEtBQWhHLEVBRlM7QUFHakIsWUFBUSxFQUFJTixVQUFVTixHQUFHYSxNQUFqQixFQUF5QkwsV0FBV1IsR0FBR2MsTUFBdkMsRUFBK0NKLFdBQVcsS0FBMUQsRUFBaUVLLFlBQVksQ0FBN0UsRUFBZ0ZILGdCQUFnQixLQUFoRyxFQUhTO0FBSWpCLFlBQVEsRUFBSU4sVUFBVU4sR0FBR08sTUFBakIsRUFBeUJDLFdBQVdSLEdBQUdTLE1BQXZDLEVBQStDQyxXQUFXLEtBQTFELEVBQWlFSyxZQUFZLENBQTdFLEVBQWdGSCxnQkFBZ0IsS0FBaEcsRUFKUztBQUtqQixZQUFRLEVBQUlOLFVBQVVOLEdBQUdnQixRQUFqQixFQUEyQlIsV0FBV1IsR0FBR2lCLFFBQXpDLEVBQW1EUCxXQUFXLEtBQTlELEVBQXFFSyxZQUFZLENBQWpGLEVBQW9GSCxnQkFBZ0IsS0FBcEcsRUFMUzs7QUFPakIsU0FBUSxFQUFJTixVQUFVTixHQUFHYSxNQUFqQixFQUF5QkwsV0FBV1IsR0FBR2MsTUFBdkMsRUFBK0NKLFdBQVcsSUFBMUQsRUFBZ0VRLGNBQWMsSUFBOUUsRUFBb0ZOLGdCQUFnQixJQUFwRyxFQVBTO0FBUWpCLFVBQVEsRUFBSU4sVUFBVU4sR0FBR2EsTUFBakIsRUFBeUJMLFdBQVdSLEdBQUdjLE1BQXZDLEVBQStDSixXQUFXLElBQTFELEVBQWdFSyxZQUFZLENBQTVFLEVBQStFSSxRQUFRLE9BQXZGLEVBQWdHUCxnQkFBZ0JYLHFCQUFxQkMsYUFBckksRUFSUztBQVNqQixVQUFRLEVBQUlJLFVBQVVOLEdBQUdhLE1BQWpCLEVBQXlCTCxXQUFXUixHQUFHYyxNQUF2QyxFQUErQ0osV0FBVyxJQUExRCxFQUFnRUssWUFBWSxDQUE1RSxFQUErRUksUUFBUSxPQUF2RixFQUFnR1AsZ0JBQWdCLElBQWhILEVBVFM7O0FBV2pCLFdBQVEsRUFBSU4sVUFBVU4sR0FBR08sTUFBakIsRUFBeUJDLFdBQVdSLEdBQUdTLE1BQXZDLEVBQStDQyxXQUFXLElBQTFELEVBQWdFSyxZQUFZLENBQTVFLEVBQStFSCxnQkFBZ0IsSUFBL0YsRUFYUztBQVlqQixXQUFRLEVBQUlOLFVBQVVOLEdBQUdPLE1BQWpCLEVBQXlCQyxXQUFXUixHQUFHUyxNQUF2QyxFQUErQ0MsV0FBVyxJQUExRCxFQUFnRUssWUFBWSxDQUE1RSxFQUErRUgsZ0JBQWdCWCxxQkFBcUJDLGFBQXBILEVBWlM7QUFhakIsV0FBUSxFQUFJSSxVQUFVTixHQUFHZ0IsUUFBakIsRUFBMkJSLFdBQVdSLEdBQUdpQixRQUF6QyxFQUFtRFAsV0FBVyxJQUE5RCxFQUFvRUssWUFBWSxDQUFoRixFQUFtRkgsZ0JBQWdCLElBQW5HLEVBYlM7O0FBZWpCLFlBQVMsRUFBSU4sVUFBVSxDQUFDTixHQUFHYSxNQUFKLEVBQVksT0FBWixFQUFxQmIsR0FBR2EsTUFBeEIsRUFBZ0NiLEdBQUdjLE1BQW5DLEVBQTJDZCxHQUFHb0IsS0FBOUMsQ0FBZCxFQUFvRVosV0FBV1IsR0FBR2MsTUFBbEYsRUFBMEZKLFdBQVcsSUFBckcsRUFBMkdLLFlBQVksQ0FBdkgsRUFBMEhILGdCQUFnQixLQUExSSxFQWZRO0FBZ0JqQixXQUFRLEVBQUlOLFVBQVUsQ0FBQ04sR0FBR2EsTUFBSixFQUFZYixHQUFHYSxNQUFmLEVBQXVCYixHQUFHYyxNQUExQixFQUFrQ2QsR0FBR29CLEtBQXJDLENBQWQsRUFBMkRaLFdBQVdSLEdBQUdjLE1BQXpFLEVBQWlGSixXQUFXLElBQTVGLEVBQWtHSyxZQUFZLENBQTlHLEVBQWlISCxnQkFBZ0I7O0FBRXpJO0FBRlEsS0FoQlMsRUFtQmpCUyxjQUFjLEVBQUlmLFVBQVVOLEdBQUdhLE1BQWpCLEVBQXlCTCxXQUFXUixHQUFHYyxNQUF2QyxFQUErQ0osV0FBVyxLQUExRCxFQUFpRVksY0FBYyxJQUEvRSxFQUFxRlYsZ0JBQWdCOztBQUVuSDtBQUZjLEtBbkJHLEVBc0JqQixTQUFTLEVBQUlOLFVBQVVOLEdBQUdPLE1BQWpCLEVBQXlCQyxXQUFXUixHQUFHUyxNQUF2QyxFQUErQ0MsV0FBVyxLQUExRCxFQUFpRUUsZ0JBQWdCWCxxQkFBcUJDLGFBQXRHLEVBdEJRO0FBdUJqQixhQUFTLEVBQUlJLFVBQVVOLEdBQUdnQixRQUFqQixFQUEyQlIsV0FBV1IsR0FBR2lCLFFBQXpDLEVBQW1EUCxXQUFXLEtBQTlELEVBQXFFRSxnQkFBZ0IsSUFBckYsRUF2QlEsRUFBbkI7O0FBMEJBVyxTQUFPQyxPQUFQLENBQWVuQixVQUFmLEVBQTJCb0IsT0FBM0IsQ0FBcUMsQ0FBQyxDQUFDQyxJQUFELEVBQU9DLEtBQVAsQ0FBRCxLQUNuQ0osT0FBT0ssTUFBUCxDQUFnQkQsS0FBaEIsRUFBeUIsRUFBQ0QsSUFBRCxFQUF6QixDQURGO0FBRUEsU0FBT3JCLFVBQVA7QUFBaUI7O0FBRW5CLE1BQU13QixhQUFhLGtCQUFuQjtBQUNPLFNBQVMvQixvQkFBVCxDQUE4QmdDLEtBQTlCLEVBQXFDO0FBQzFDLE1BQUlDLFFBQVEsQ0FBQyxJQUFELENBQVo7QUFBQSxNQUFvQkMsaUJBQWUsQ0FBbkM7QUFBQSxNQUFzQ0MsT0FBSyxDQUFDLEVBQUQsRUFBSyxDQUFMLENBQTNDO0FBQ0EsTUFBSUMsa0JBQWdCLENBQXBCOztBQUVBSixRQUFNSyxPQUFOLENBQWdCTixVQUFoQixFQUE0QixDQUFDTyxLQUFELEVBQVFDLE1BQVIsRUFBZ0JDLE9BQWhCLEVBQXlCQyxHQUF6QixLQUFpQztBQUMzRCxRQUFHLENBQUVELE9BQUwsRUFBZTtBQUNiTix1QkFBaUJDLElBQWpCO0FBQ0FJLGVBQVMsS0FBVDtBQUFjLEtBRmhCLE1BR0s7QUFDSDtBQUNBTCx1QkFBaUJPLE1BQU1ILE1BQU1JLE1BQTdCO0FBQ0FOLHdCQUFrQkgsTUFBTVMsTUFBeEI7QUFDQVAsYUFBT0QsY0FBUDtBQUFxQjtBQUN2QkQsVUFBTVUsSUFBTixDQUFhLEVBQUNDLE1BQU1YLE1BQU1TLE1BQWIsRUFBcUJHLGlCQUFnQkosR0FBckMsRUFBMENQLGNBQTFDLEVBQTBESyxNQUExRCxFQUFrRUMsT0FBbEUsRUFBYjtBQUNBLFdBQU8sRUFBUDtBQUFTLEdBVlg7O0FBWUFQLFFBQU1hLE1BQU4sQ0FBYSxJQUFFVixlQUFmLEVBaEIwQyxDQWdCVjtBQUNoQyxTQUFPSCxLQUFQO0FBQVkiLCJmaWxlIjoib2Zmc2lkZV9vcHMuanMiLCJzb3VyY2VzQ29udGVudCI6WyJcbmV4cG9ydCBmdW5jdGlvbiBvZmZzaWRlT3BlcmF0b3JzRm9yQmFieWxvbih0b2tUeXBlcykgOjpcbiAgY29uc3QgdHQgPSB0b2tUeXBlc1xuXG4gIGNvbnN0IGltcGxpY2l0Q29tbWFDb250ZXh0ID0gQDpcbiAgICBvYmplY3RMaXRlcmFsOiBuZXcgU2V0IEAjXG4gICAgICB0dC5zdGFyIC8vIGFsbG93IGdlbmVyYXRvciBkZWZpbnRpb25zIHdpdGggaW1wbGljaXQgY29tbWFzXG5cbiAgY29uc3QgYXRfb2Zmc2lkZSA9IEB7fVxuICAgICc6Oic6ICAgQHt9IHRva2VuUHJlOiB0dC5icmFjZUwsIHRva2VuUG9zdDogdHQuYnJhY2VSLCBuZXN0SW5uZXI6IGZhbHNlLCBjb2RlQmxvY2s6IHRydWUsIGltcGxpY2l0Q29tbWFzOiBmYWxzZSxcbiAgICAnOjpAJzogIEB7fSB0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiBmYWxzZSwgZXh0cmFDaGFyczogMSwgaW1wbGljaXRDb21tYXM6IGZhbHNlLFxuICAgICc6OigpJzogQHt9IHRva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IGZhbHNlLCBleHRyYUNoYXJzOiAyLCBpbXBsaWNpdENvbW1hczogZmFsc2UsXG4gICAgJzo6e30nOiBAe30gdG9rZW5QcmU6IHR0LmJyYWNlTCwgdG9rZW5Qb3N0OiB0dC5icmFjZVIsIG5lc3RJbm5lcjogZmFsc2UsIGV4dHJhQ2hhcnM6IDIsIGltcGxpY2l0Q29tbWFzOiBmYWxzZSxcbiAgICAnOjpbXSc6IEB7fSB0b2tlblByZTogdHQuYnJhY2tldEwsIHRva2VuUG9zdDogdHQuYnJhY2tldFIsIG5lc3RJbm5lcjogZmFsc2UsIGV4dHJhQ2hhcnM6IDIsIGltcGxpY2l0Q29tbWFzOiBmYWxzZSxcblxuICAgICdAJzogICAgQHt9IHRva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IHRydWUsIGtleXdvcmRCbG9jazogdHJ1ZSwgaW1wbGljaXRDb21tYXM6IHRydWUsXG4gICAgJ0A6JzogICBAe30gdG9rZW5QcmU6IHR0LnBhcmVuTCwgdG9rZW5Qb3N0OiB0dC5wYXJlblIsIG5lc3RJbm5lcjogdHJ1ZSwgZXh0cmFDaGFyczogMSwgbmVzdE9wOiAnXFwweyx9JywgaW1wbGljaXRDb21tYXM6IGltcGxpY2l0Q29tbWFDb250ZXh0Lm9iamVjdExpdGVyYWwsXG4gICAgJ0AjJzogICBAe30gdG9rZW5QcmU6IHR0LnBhcmVuTCwgdG9rZW5Qb3N0OiB0dC5wYXJlblIsIG5lc3RJbm5lcjogdHJ1ZSwgZXh0cmFDaGFyczogMSwgbmVzdE9wOiAnXFwwWyxdJywgaW1wbGljaXRDb21tYXM6IHRydWUsXG5cbiAgICAnQCgpJzogIEB7fSB0b2tlblByZTogdHQuYnJhY2VMLCB0b2tlblBvc3Q6IHR0LmJyYWNlUiwgbmVzdElubmVyOiB0cnVlLCBleHRyYUNoYXJzOiAyLCBpbXBsaWNpdENvbW1hczogdHJ1ZSxcbiAgICAnQHt9JzogIEB7fSB0b2tlblByZTogdHQuYnJhY2VMLCB0b2tlblBvc3Q6IHR0LmJyYWNlUiwgbmVzdElubmVyOiB0cnVlLCBleHRyYUNoYXJzOiAyLCBpbXBsaWNpdENvbW1hczogaW1wbGljaXRDb21tYUNvbnRleHQub2JqZWN0TGl0ZXJhbCxcbiAgICAnQFtdJzogIEB7fSB0b2tlblByZTogdHQuYnJhY2tldEwsIHRva2VuUG9zdDogdHQuYnJhY2tldFIsIG5lc3RJbm5lcjogdHJ1ZSwgZXh0cmFDaGFyczogMiwgaW1wbGljaXRDb21tYXM6IHRydWUsXG5cbiAgICAnQD0+Pic6ICBAe30gdG9rZW5QcmU6IFt0dC5wYXJlbkwsICdhc3luYycsIHR0LnBhcmVuTCwgdHQucGFyZW5SLCB0dC5hcnJvd10sIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IHRydWUsIGV4dHJhQ2hhcnM6IDMsIGltcGxpY2l0Q29tbWFzOiBmYWxzZSxcbiAgICAnQD0+JzogIEB7fSB0b2tlblByZTogW3R0LnBhcmVuTCwgdHQucGFyZW5MLCB0dC5wYXJlblIsIHR0LmFycm93XSwgdG9rZW5Qb3N0OiB0dC5wYXJlblIsIG5lc3RJbm5lcjogdHJ1ZSwgZXh0cmFDaGFyczogMiwgaW1wbGljaXRDb21tYXM6IGZhbHNlLFxuXG4gICAgLy8gbm90ZTogIG5vICdAKCknIC0tIHN0YW5kYXJkaXplIHRvIHVzZSBzaW5nbGUtY2hhciAnQCAnIGluc3RlYWRcbiAgICBrZXl3b3JkX2FyZ3M6IEB7fSB0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiBmYWxzZSwgaW5LZXl3b3JkQXJnOiB0cnVlLCBpbXBsaWNpdENvbW1hczogZmFsc2UsXG5cbiAgICAvLyBzeW50aGV0aWMgbmVzdE9wIGRlbGVnYXRlIG9wZXJhdGlvbnNcbiAgICAnXFwweyx9JzogQHt9IHRva2VuUHJlOiB0dC5icmFjZUwsIHRva2VuUG9zdDogdHQuYnJhY2VSLCBuZXN0SW5uZXI6IGZhbHNlLCBpbXBsaWNpdENvbW1hczogaW1wbGljaXRDb21tYUNvbnRleHQub2JqZWN0TGl0ZXJhbCxcbiAgICAnXFwwWyxdJzogQHt9IHRva2VuUHJlOiB0dC5icmFja2V0TCwgdG9rZW5Qb3N0OiB0dC5icmFja2V0UiwgbmVzdElubmVyOiBmYWxzZSwgaW1wbGljaXRDb21tYXM6IHRydWUsXG5cblxuICBPYmplY3QuZW50cmllcyhhdF9vZmZzaWRlKS5mb3JFYWNoIEAgKFtuYW1lLCBvcFJlY10pID0+XG4gICAgT2JqZWN0LmFzc2lnbiBAIG9wUmVjLCBAOiBuYW1lXG4gIHJldHVybiBhdF9vZmZzaWRlXG5cbmNvbnN0IHJ4X29mZnNpZGUgPSAvXihbIFxcdF0qKSguKikkL21nXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VPZmZzaWRlSW5kZXhNYXAoaW5wdXQpIDo6XG4gIGxldCBsaW5lcyA9IFtudWxsXSwgcG9zTGFzdENvbnRlbnQ9MCwgbGFzdD1bJycsIDBdXG4gIGxldCBpZHhfbGFzdENvbnRlbnQ9MFxuXG4gIGlucHV0LnJlcGxhY2UgQCByeF9vZmZzaWRlLCAobWF0Y2gsIGluZGVudCwgY29udGVudCwgcG9zKSA9PiA6OlxuICAgIGlmICEgY29udGVudCA6OlxuICAgICAgcG9zTGFzdENvbnRlbnQgPSBsYXN0XG4gICAgICBpbmRlbnQgPSBmYWxzZVxuICAgIGVsc2UgOjpcbiAgICAgIC8vIHZhbGlkIGNvbnRlbnQ7IHNldCBsYXN0IHRvIGN1cnJlbnQgaW5kZW50XG4gICAgICBwb3NMYXN0Q29udGVudCA9IHBvcyArIG1hdGNoLmxlbmd0aFxuICAgICAgaWR4X2xhc3RDb250ZW50ID0gbGluZXMubGVuZ3RoXG4gICAgICBsYXN0ID0gcG9zTGFzdENvbnRlbnRcbiAgICBsaW5lcy5wdXNoIEA6IGxpbmU6IGxpbmVzLmxlbmd0aCwgcG9zRmlyc3RDb250ZW50OnBvcywgcG9zTGFzdENvbnRlbnQsIGluZGVudCwgY29udGVudFxuICAgIHJldHVybiAnJ1xuXG4gIGxpbmVzLnNwbGljZSgxK2lkeF9sYXN0Q29udGVudCkgLy8gdHJpbSB0cmFpbGluZyB3aGl0ZXNwYWNlXG4gIHJldHVybiBsaW5lc1xuXG4iXX0=