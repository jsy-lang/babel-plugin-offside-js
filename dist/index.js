'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ensureConsistentBlockIndent = exports.parseOffsideIndexMap = exports.hookBabylon = undefined;

var _parser = require('./parser');

var _offside_ops = require('./offside_ops');

var _plugin = require('./plugin');

var _plugin2 = _interopRequireDefault(_plugin);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

exports.default = _plugin2.default;
exports.hookBabylon = _parser.hookBabylon;
exports.parseOffsideIndexMap = _offside_ops.parseOffsideIndexMap;
exports.ensureConsistentBlockIndent = _plugin.ensureConsistentBlockIndent;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL2NvZGUvaW5kZXguanMiXSwibmFtZXMiOlsiaG9va0JhYnlsb24iLCJwYXJzZU9mZnNpZGVJbmRleE1hcCIsImVuc3VyZUNvbnNpc3RlbnRCbG9ja0luZGVudCJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUNBOztBQUNBOzs7Ozs7O1FBSUVBLFc7UUFDQUMsb0I7UUFDQUMsMkIiLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge2hvb2tCYWJ5bG9ufSBmcm9tICcuL3BhcnNlcidcbmltcG9ydCB7cGFyc2VPZmZzaWRlSW5kZXhNYXB9IGZyb20gJy4vb2Zmc2lkZV9vcHMnXG5pbXBvcnQgYmFiZWxfcGx1Z2luX29mZnNpZGVfanMsIHtlbnN1cmVDb25zaXN0ZW50QmxvY2tJbmRlbnR9IGZyb20gJy4vcGx1Z2luJ1xuXG5leHBvcnQgZGVmYXVsdCBiYWJlbF9wbHVnaW5fb2Zmc2lkZV9qc1xuZXhwb3J0IEB7fVxuICBob29rQmFieWxvblxuICBwYXJzZU9mZnNpZGVJbmRleE1hcFxuICBlbnN1cmVDb25zaXN0ZW50QmxvY2tJbmRlbnRcbiJdfQ==