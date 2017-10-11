import {hookBabylon, asOffsideJSBabylon, installOffsideBabylonParsers} from './parser'
import {parseOffsideIndexMap} from './offside_ops'
import babel_plugin_offside_js, {ensureConsistentBlockIndent} from './plugin'

let installed

export default function() ::
  if ! installed ::
    installOffsideBabylonParsers()
    installed = true

  return babel_plugin_offside_js()

export @{}
  hookBabylon
  asOffsideJSBabylon
  parseOffsideIndexMap
  ensureConsistentBlockIndent
