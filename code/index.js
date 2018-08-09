import {hookBabylon, asOffsideJSBabylon, installOffsideBabylonParsers} from './parser'
import {parseOffsideIndexMap} from './offside_ops'
import babel_plugin_offside_js, {ensureConsistentBlockIndent} from './plugin'

var _is_offside_js_installed
function installed_offside_js() ::
  if ! _is_offside_js_installed ::
    installOffsideBabylonParsers()
    _is_offside_js_installed = true

  return babel_plugin_offside_js()

module.exports = installed_offside_js
Object.assign @ module.exports, @{}
  hookBabylon
  asOffsideJSBabylon
  parseOffsideIndexMap
  ensureConsistentBlockIndent
