'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ensureConsistentBlockIndent = exports.parseOffsideIndexMap = exports.asOffsideJSBabylon = exports.hookBabylon = undefined;

exports.default = function () {
  if (!installed) {
    (0, _parser.installOffsideBabylonParsers)();
    installed = true;
  }

  return (0, _plugin2.default)();
};

var _parser = require('./parser');

var _offside_ops = require('./offside_ops');

var _plugin = require('./plugin');

var _plugin2 = _interopRequireDefault(_plugin);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

let installed;

exports.hookBabylon = _parser.hookBabylon;
exports.asOffsideJSBabylon = _parser.asOffsideJSBabylon;
exports.parseOffsideIndexMap = _offside_ops.parseOffsideIndexMap;
exports.ensureConsistentBlockIndent = _plugin.ensureConsistentBlockIndent;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL2NvZGUvaW5kZXguanMiXSwibmFtZXMiOlsiaW5zdGFsbGVkIiwiaG9va0JhYnlsb24iLCJhc09mZnNpZGVKU0JhYnlsb24iLCJwYXJzZU9mZnNpZGVJbmRleE1hcCIsImVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudCJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztrQkFNZSxZQUFXO0FBQ3hCLE1BQUcsQ0FBRUEsU0FBTCxFQUFpQjtBQUNmO0FBQ0FBLGdCQUFZLElBQVo7QUFBZ0I7O0FBRWxCLFNBQU8sdUJBQVA7QUFBZ0MsQzs7QUFYbEM7O0FBQ0E7O0FBQ0E7Ozs7OztBQUVBLElBQUlBLFNBQUo7O1FBVUVDLFc7UUFDQUMsa0I7UUFDQUMsb0I7UUFDQUMsMkIiLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge2hvb2tCYWJ5bG9uLCBhc09mZnNpZGVKU0JhYnlsb24sIGluc3RhbGxPZmZzaWRlQmFieWxvblBhcnNlcnN9IGZyb20gJy4vcGFyc2VyJ1xuaW1wb3J0IHtwYXJzZU9mZnNpZGVJbmRleE1hcH0gZnJvbSAnLi9vZmZzaWRlX29wcydcbmltcG9ydCBiYWJlbF9wbHVnaW5fb2Zmc2lkZV9qcywge2Vuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudH0gZnJvbSAnLi9wbHVnaW4nXG5cbmxldCBpbnN0YWxsZWRcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSA6OlxuICBpZiAhIGluc3RhbGxlZCA6OlxuICAgIGluc3RhbGxPZmZzaWRlQmFieWxvblBhcnNlcnMoKVxuICAgIGluc3RhbGxlZCA9IHRydWVcblxuICByZXR1cm4gYmFiZWxfcGx1Z2luX29mZnNpZGVfanMoKVxuXG5leHBvcnQgQHt9XG4gIGhvb2tCYWJ5bG9uXG4gIGFzT2Zmc2lkZUpTQmFieWxvblxuICBwYXJzZU9mZnNpZGVJbmRleE1hcFxuICBlbnN1cmVDb25zaXN0ZW50QmxvY2tJbmRlbnRcbiJdfQ==