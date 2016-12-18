'use strict'
const assert = require('assert')
const babylon = require('babylon')
const tt = babylon.tokTypes

const Parser = hookBabylon()
const baseProto = Parser.prototype
const pp = Parser.prototype = Object.create(baseProto)

function hookBabylon() {
  // abuse Babylon token updateContext callback extract
  // the reference to Parser

  let Parser
  let tgt_patch = babylon.tokTypes.braceL
  let fn_updateContext = tgt_patch.updateContext
  tgt_patch.updateContext = function (prevType) {
    tgt_patch.updateContext = fn_updateContext
    Parser = this.constructor }

  babylon.parse('{}')
  if (!Parser) throw new Error("Failed to hook Babylon Parser")
  return Parser }



pp.parse = function() {
  this.initOffside()
  return baseProto.parse.call(this)
}

class OffsideBreakout extends Error {}
const offsideBreakout = new OffsideBreakout()

pp.initOffside = function() {
  this.state.offside = []
  this.offside_map = parseOffsideIndexMap(this.input)

  this.state._pos = this.state.pos
  Object.defineProperty(this.state, 'pos', {
    get() { return this._pos },
    set(pos) {
      // interrupt skipSpace algorithm when we hit our position 'breakpoint'
      if (pos === this.offside_pos)
        throw offsideBreakout
      else this._pos = pos
    },
    enumerable: true })
}

let at_offside = new Map()
at_offside.set(tt.braceL, tt.braceR)
at_offside.set(tt.parenL, tt.parenR)
at_offside.set(tt.bracketL, tt.bracketR)

pp.finishToken = function(type, val) {
  baseProto.finishToken.call(this, type, val)

  if (tt.doubleColon === type)
    return this.pushOffside(tt.braceL, tt.braceR)

  if (tt.at === type) {
    const lh = this.lookahead()
    if (lh.curLine !== this.state.curLine || !at_offside.has(lh.type))
      return this.pushOffside(tt.parenL, tt.parenR)

    this.nextToken()
    let tt_pre = this.state.type
    assert(tt_pre === lh.type, ['failed lookahead', tt_pre])
    this.nextToken()
    let tt_post = this.state.type
    assert(tt_post === at_offside.get(tt_pre), ['mismatch', tt_post, at_offside.get(tt_pre)])

    return this.pushOffside(tt_pre, tt_post) 
  }
}

pp.offsideBlock = function (tt_post) {
  let offside = this.offside_map

  const line0 = this.state.curLine
  const indent = offside[line0].indent
  let line = 1+line0, last = offside[line0]

  while (line < offside.length) {
    let tip = offside[line]
    if (!tip.empty && indent >= tip.indent)
      break

    line++; last = tip
  }
  
  return {tt_post, last}
}

pp.pushOffside = function (tt_pre, tt_post) {
  this.finishToken(tt_pre)
  if (!this.isLookahead)
    this.state.offside.push(this.offsideBlock(tt_post))
}

pp.skipSpace = function() {
  let tip, stack = this.state.offside
  if (stack && stack.length) {
    tip = stack[stack.length-1]
    this.state.offside_pos = tip.last.pos1
  } else this.state.offside_pos = null

  try {
    baseProto.skipSpace.call(this)
    this.state.offside_pos = null
  } catch (err) {
    if (err !== offsideBreakout) throw err;
  }
}

pp.readToken = function(code) {
  if (this.state.pos+1 !== this.state.offside_pos)
    return baseProto.readToken.call(this, code)

  let stack = this.state.offside
  let tip = this.isLookahead ? stack[stack.length-1] : stack.pop()
  this.state.offside_pos = null

  this.finishToken(tip.tt_post)
  return tip.tt_post
}



const rx_offside = /^([ \t]*)(.*)$/mg
function parseOffsideIndexMap(input) {
  let lines = [null], pos1=0, tip=['',pos1]
  let ans = input.replace(rx_offside, (match, indent, content, pos0) => {
    if (!content) {
      [indent, pos1] = tip // blank line; use last valid tip
    } else {
      // valid content; set tip to current indent
      pos1 = pos0 + match.length + 1
      tip = [indent, pos1]
    }

    lines.push({pos0, pos1, line: lines.length, empty:!content, indent, content})
    return '' })
  lines.push({pos0: input.length, pos1: input.length, indent:''})
  return lines }



module.exports = exports = (babel) => ({
  manipulateOptions(opts, parserOpts) {
    parserOpts.plugins.push('decorators', 'functionBind')
  }
})


Object.assign(exports, {
  hookBabylon,
  parseOffsideIndexMap,
})

