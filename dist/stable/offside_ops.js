'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.at_offside = undefined;
exports.parseOffsideIndexMap = parseOffsideIndexMap;

var _babylon = require('babylon');

var babylon = _interopRequireWildcard(_babylon);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

const tt = babylon.tokTypes;

const at_offside = exports.at_offside = {
  '::': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: false, codeBlock: true },
  '::@': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, extraChars: 1 },
  '::()': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, extraChars: 2 },
  '::{}': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: false, extraChars: 2 },
  '::[]': { tokenPre: tt.bracketL, tokenPost: tt.bracketR, nestInner: false, extraChars: 2 },
  '@': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: true, keywordBlock: true },
  '@:': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: true, extraChars: 1, nestOp: '::{}' },
  '@#': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: true, extraChars: 1, nestOp: '::[]' },
  '@()': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: true, extraChars: 2 },
  '@{}': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: true, extraChars: 2 },
  '@[]': { tokenPre: tt.bracketL, tokenPost: tt.bracketR, nestInner: true, extraChars: 2
    // note:  no '@()' -- standardize to use single-char '@ ' instead
  }, keyword_args: { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, inKeywordArg: true } };

const rx_offside = /^([ \t]*)(.*)$/mg;
function parseOffsideIndexMap(input) {
  let lines = [null],
      posLastContent = 0,
      last = ['', 0];
  let idx_lastContent = 0;

  input.replace(rx_offside, (match, indent, content, pos) => {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL2NvZGUvb2Zmc2lkZV9vcHMuanMiXSwibmFtZXMiOlsicGFyc2VPZmZzaWRlSW5kZXhNYXAiLCJiYWJ5bG9uIiwidHQiLCJ0b2tUeXBlcyIsImF0X29mZnNpZGUiLCJ0b2tlblByZSIsImJyYWNlTCIsInRva2VuUG9zdCIsImJyYWNlUiIsIm5lc3RJbm5lciIsImNvZGVCbG9jayIsInBhcmVuTCIsInBhcmVuUiIsImV4dHJhQ2hhcnMiLCJicmFja2V0TCIsImJyYWNrZXRSIiwia2V5d29yZEJsb2NrIiwibmVzdE9wIiwia2V5d29yZF9hcmdzIiwiaW5LZXl3b3JkQXJnIiwicnhfb2Zmc2lkZSIsImlucHV0IiwibGluZXMiLCJwb3NMYXN0Q29udGVudCIsImxhc3QiLCJpZHhfbGFzdENvbnRlbnQiLCJyZXBsYWNlIiwibWF0Y2giLCJpbmRlbnQiLCJjb250ZW50IiwicG9zIiwibGVuZ3RoIiwicHVzaCIsImxpbmUiLCJzcGxpY2UiXSwibWFwcGluZ3MiOiI7Ozs7OztRQW9CZ0JBLG9CLEdBQUFBLG9COztBQXBCaEI7O0lBQVlDLE87Ozs7QUFDWixNQUFNQyxLQUFLRCxRQUFRRSxRQUFuQjs7QUFFTyxNQUFNQyxrQ0FBYTtBQUNwQixRQUFRLEVBQUNDLFVBQVVILEdBQUdJLE1BQWQsRUFBc0JDLFdBQVdMLEdBQUdNLE1BQXBDLEVBQTRDQyxXQUFXLEtBQXZELEVBQThEQyxXQUFXLElBQXpFLEVBRFk7QUFFcEIsU0FBUSxFQUFDTCxVQUFVSCxHQUFHUyxNQUFkLEVBQXNCSixXQUFXTCxHQUFHVSxNQUFwQyxFQUE0Q0gsV0FBVyxLQUF2RCxFQUE4REksWUFBWSxDQUExRSxFQUZZO0FBR3BCLFVBQVEsRUFBQ1IsVUFBVUgsR0FBR1MsTUFBZCxFQUFzQkosV0FBV0wsR0FBR1UsTUFBcEMsRUFBNENILFdBQVcsS0FBdkQsRUFBOERJLFlBQVksQ0FBMUUsRUFIWTtBQUlwQixVQUFRLEVBQUNSLFVBQVVILEdBQUdJLE1BQWQsRUFBc0JDLFdBQVdMLEdBQUdNLE1BQXBDLEVBQTRDQyxXQUFXLEtBQXZELEVBQThESSxZQUFZLENBQTFFLEVBSlk7QUFLcEIsVUFBUSxFQUFDUixVQUFVSCxHQUFHWSxRQUFkLEVBQXdCUCxXQUFXTCxHQUFHYSxRQUF0QyxFQUFnRE4sV0FBVyxLQUEzRCxFQUFrRUksWUFBWSxDQUE5RSxFQUxZO0FBTXBCLE9BQVEsRUFBQ1IsVUFBVUgsR0FBR1MsTUFBZCxFQUFzQkosV0FBV0wsR0FBR1UsTUFBcEMsRUFBNENILFdBQVcsSUFBdkQsRUFBNkRPLGNBQWMsSUFBM0UsRUFOWTtBQU9wQixRQUFRLEVBQUNYLFVBQVVILEdBQUdTLE1BQWQsRUFBc0JKLFdBQVdMLEdBQUdVLE1BQXBDLEVBQTRDSCxXQUFXLElBQXZELEVBQTZESSxZQUFZLENBQXpFLEVBQTRFSSxRQUFRLE1BQXBGLEVBUFk7QUFRcEIsUUFBUSxFQUFDWixVQUFVSCxHQUFHUyxNQUFkLEVBQXNCSixXQUFXTCxHQUFHVSxNQUFwQyxFQUE0Q0gsV0FBVyxJQUF2RCxFQUE2REksWUFBWSxDQUF6RSxFQUE0RUksUUFBUSxNQUFwRixFQVJZO0FBU3BCLFNBQVEsRUFBQ1osVUFBVUgsR0FBR0ksTUFBZCxFQUFzQkMsV0FBV0wsR0FBR00sTUFBcEMsRUFBNENDLFdBQVcsSUFBdkQsRUFBNkRJLFlBQVksQ0FBekUsRUFUWTtBQVVwQixTQUFRLEVBQUNSLFVBQVVILEdBQUdJLE1BQWQsRUFBc0JDLFdBQVdMLEdBQUdNLE1BQXBDLEVBQTRDQyxXQUFXLElBQXZELEVBQTZESSxZQUFZLENBQXpFLEVBVlk7QUFXcEIsU0FBUSxFQUFDUixVQUFVSCxHQUFHWSxRQUFkLEVBQXdCUCxXQUFXTCxHQUFHYSxRQUF0QyxFQUFnRE4sV0FBVyxJQUEzRCxFQUFpRUksWUFBWTtBQUN2RjtBQURVLEdBWFksRUFhcEJLLGNBQWMsRUFBQ2IsVUFBVUgsR0FBR1MsTUFBZCxFQUFzQkosV0FBV0wsR0FBR1UsTUFBcEMsRUFBNENILFdBQVcsS0FBdkQsRUFBOERVLGNBQWMsSUFBNUUsRUFiTSxFQUFuQjs7QUFnQlAsTUFBTUMsYUFBYSxrQkFBbkI7QUFDTyxTQUFTcEIsb0JBQVQsQ0FBOEJxQixLQUE5QixFQUFxQztBQUMxQyxNQUFJQyxRQUFRLENBQUMsSUFBRCxDQUFaO0FBQUEsTUFBb0JDLGlCQUFlLENBQW5DO0FBQUEsTUFBc0NDLE9BQUssQ0FBQyxFQUFELEVBQUssQ0FBTCxDQUEzQztBQUNBLE1BQUlDLGtCQUFnQixDQUFwQjs7QUFFQUosUUFBTUssT0FBTixDQUFnQk4sVUFBaEIsRUFBNEIsQ0FBQ08sS0FBRCxFQUFRQyxNQUFSLEVBQWdCQyxPQUFoQixFQUF5QkMsR0FBekIsS0FBaUM7QUFDM0QsUUFBRyxDQUFFRCxPQUFMLEVBQWU7QUFDYixPQUFDRCxNQUFELEVBQVNMLGNBQVQsSUFBMkJDLElBQTNCLENBRGEsQ0FDbUI7QUFBNEMsS0FEOUUsTUFFSztBQUNIO0FBQ0FELHlCQUFpQk8sTUFBTUgsTUFBTUksTUFBN0I7QUFDQU4sMEJBQWtCSCxNQUFNUyxNQUF4QjtBQUNBUCxlQUFPLENBQUNJLE1BQUQsRUFBU0wsY0FBVCxDQUFQO0FBQStCO0FBQ2pDRCxVQUFNVSxJQUFOLENBQWEsRUFBQ0MsTUFBTVgsTUFBTVMsTUFBYixFQUFxQlIsY0FBckIsRUFBcUNLLE1BQXJDLEVBQTZDQyxPQUE3QyxFQUFiO0FBQ0EsV0FBTyxFQUFQO0FBQVMsR0FUWDs7QUFXQVAsUUFBTVksTUFBTixDQUFhLElBQUVULGVBQWYsRUFmMEMsQ0FlVjtBQUNoQyxTQUFPSCxLQUFQO0FBQVkiLCJmaWxlIjoib2Zmc2lkZV9vcHMuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBiYWJ5bG9uIGZyb20gJ2JhYnlsb24nXG5jb25zdCB0dCA9IGJhYnlsb24udG9rVHlwZXNcblxuZXhwb3J0IGNvbnN0IGF0X29mZnNpZGUgPSBAe31cbiAgICAgICc6Oic6ICAge3Rva2VuUHJlOiB0dC5icmFjZUwsIHRva2VuUG9zdDogdHQuYnJhY2VSLCBuZXN0SW5uZXI6IGZhbHNlLCBjb2RlQmxvY2s6IHRydWV9XG4gICAgLCAnOjpAJzogIHt0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiBmYWxzZSwgZXh0cmFDaGFyczogMX1cbiAgICAsICc6OigpJzoge3Rva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IGZhbHNlLCBleHRyYUNoYXJzOiAyfVxuICAgICwgJzo6e30nOiB7dG9rZW5QcmU6IHR0LmJyYWNlTCwgdG9rZW5Qb3N0OiB0dC5icmFjZVIsIG5lc3RJbm5lcjogZmFsc2UsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnOjpbXSc6IHt0b2tlblByZTogdHQuYnJhY2tldEwsIHRva2VuUG9zdDogdHQuYnJhY2tldFIsIG5lc3RJbm5lcjogZmFsc2UsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnQCc6ICAgIHt0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiB0cnVlLCBrZXl3b3JkQmxvY2s6IHRydWV9XG4gICAgLCAnQDonOiAgIHt0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiB0cnVlLCBleHRyYUNoYXJzOiAxLCBuZXN0T3A6ICc6Ont9J31cbiAgICAsICdAIyc6ICAge3Rva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IHRydWUsIGV4dHJhQ2hhcnM6IDEsIG5lc3RPcDogJzo6W10nfVxuICAgICwgJ0AoKSc6ICB7dG9rZW5QcmU6IHR0LmJyYWNlTCwgdG9rZW5Qb3N0OiB0dC5icmFjZVIsIG5lc3RJbm5lcjogdHJ1ZSwgZXh0cmFDaGFyczogMn1cbiAgICAsICdAe30nOiAge3Rva2VuUHJlOiB0dC5icmFjZUwsIHRva2VuUG9zdDogdHQuYnJhY2VSLCBuZXN0SW5uZXI6IHRydWUsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnQFtdJzogIHt0b2tlblByZTogdHQuYnJhY2tldEwsIHRva2VuUG9zdDogdHQuYnJhY2tldFIsIG5lc3RJbm5lcjogdHJ1ZSwgZXh0cmFDaGFyczogMn1cbiAgICAvLyBub3RlOiAgbm8gJ0AoKScgLS0gc3RhbmRhcmRpemUgdG8gdXNlIHNpbmdsZS1jaGFyICdAICcgaW5zdGVhZFxuICAgICwga2V5d29yZF9hcmdzOiB7dG9rZW5QcmU6IHR0LnBhcmVuTCwgdG9rZW5Qb3N0OiB0dC5wYXJlblIsIG5lc3RJbm5lcjogZmFsc2UsIGluS2V5d29yZEFyZzogdHJ1ZX1cblxuXG5jb25zdCByeF9vZmZzaWRlID0gL14oWyBcXHRdKikoLiopJC9tZ1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlT2Zmc2lkZUluZGV4TWFwKGlucHV0KSA6OlxuICBsZXQgbGluZXMgPSBbbnVsbF0sIHBvc0xhc3RDb250ZW50PTAsIGxhc3Q9WycnLCAwXVxuICBsZXQgaWR4X2xhc3RDb250ZW50PTBcblxuICBpbnB1dC5yZXBsYWNlIEAgcnhfb2Zmc2lkZSwgKG1hdGNoLCBpbmRlbnQsIGNvbnRlbnQsIHBvcykgPT4gOjpcbiAgICBpZiAhIGNvbnRlbnQgOjpcbiAgICAgIFtpbmRlbnQsIHBvc0xhc3RDb250ZW50XSA9IGxhc3QgLy8gYmxhbmsgbGluZTsgdXNlIGxhc3QgdmFsaWQgY29udGVudCBhcyBlbmRcbiAgICBlbHNlIDo6XG4gICAgICAvLyB2YWxpZCBjb250ZW50OyBzZXQgbGFzdCB0byBjdXJyZW50IGluZGVudFxuICAgICAgcG9zTGFzdENvbnRlbnQgPSBwb3MgKyBtYXRjaC5sZW5ndGhcbiAgICAgIGlkeF9sYXN0Q29udGVudCA9IGxpbmVzLmxlbmd0aFxuICAgICAgbGFzdCA9IFtpbmRlbnQsIHBvc0xhc3RDb250ZW50XVxuICAgIGxpbmVzLnB1c2ggQDogbGluZTogbGluZXMubGVuZ3RoLCBwb3NMYXN0Q29udGVudCwgaW5kZW50LCBjb250ZW50XG4gICAgcmV0dXJuICcnXG5cbiAgbGluZXMuc3BsaWNlKDEraWR4X2xhc3RDb250ZW50KSAvLyB0cmltIHRyYWlsaW5nIHdoaXRlc3BhY2VcbiAgcmV0dXJuIGxpbmVzXG5cbiJdfQ==