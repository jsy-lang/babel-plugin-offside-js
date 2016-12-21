'use strict'
const assert = require('assert')
const babylon = require('babylon')
const tt = babylon.tokTypes

const Parser = hookBabylon()
const baseProto = Parser.prototype
const pp = Parser.prototype = Object.create(baseProto)

function hookBabylon() ::
  // abuse Babylon token updateContext callback extract
  // the reference to Parser

  let Parser
  let tgt_patch = babylon.tokTypes.braceL
  let fn_updateContext = tgt_patch.updateContext
  tgt_patch.updateContext = function (prevType) ::
    tgt_patch.updateContext = fn_updateContext
    Parser = this.constructor

  babylon.parse('{}')
  if (!Parser)
    throw new Error @ "Failed to hook Babylon Parser"
  return Parser



pp.parse = function() ::
  this.initOffside()
  return baseProto.parse.call(this)


class OffsideBreakout extends Error {}
const offsideBreakout = new OffsideBreakout()

pp.initOffside = function() ::
  this.state.offside = []
  this.offside_lines = parseOffsideIndexMap(this.input)

  this.state._pos = this.state.pos
  Object.defineProperty @ this.state, 'pos', ::
    enumerable: true
    , get() :: return this._pos
    , set(pos) ::
      // interrupt skipSpace algorithm when we hit our position 'breakpoint'
      let offPos = this.offsidePos
      if (offPos>=0 && (pos > offPos))
        throw offsideBreakout

      this._pos = pos


let tt_offside =
  @{} '{': tt.braceL,   '}': tt.braceR
    , '(': tt.parenL,   ')': tt.parenR
    , '[': tt.bracketL, ']': tt.bracketR

let at_offside =
  @{} '::':  {tokenPre: '{', tokenPost: '}', nestInner: false}
    , '@':   {tokenPre: '(', tokenPost: ')', nestInner: true}
    , '@{}': {tokenPre: '{', tokenPost: '}', nestInner: true, extraChars: 2}
    , '@[]': {tokenPre: '[', tokenPost: ']', nestInner: true, extraChars: 2}
    // note: no '@()' -- standardize to use single-char '@ ' instead

pp.finishToken = function(type, val) ::
  let op
  if (tt.doubleColon === type) ::
    return this.finishOffsideOp(at_offside['::'])

  if (tt.at === type) ::
    const str_op = this.input.slice(this.state.pos-1, this.state.pos+2)

    if (/^@\s/.test(str_op)) ::
      return this.finishOffsideOp(at_offside['@'])

    op = at_offside[str_op.slice(0,2)]
    if (op) return this.finishOffsideOp(op)

    op = at_offside[str_op]
    if (op) return this.finishOffsideOp(op)


  if (tt.eof === type) ::
    if (this.state.offside.length) ::
      return this.popOffside()


  return baseProto.finishToken.call(this, type, val)



pp.offsideBlock = function (op, stackTop) ::
  let offside_lines = this.offside_lines

  const line0 = this.state.curLine
  const first = offside_lines[line0]
  const nestInner = op.nestInner && stackTop && line0 === stackTop.first.line
  const indent = nestInner ? stackTop.innerIndent : first.indent
  let line = 1+line0, last = first
  let innerIndent = offside_lines[line].indent

  while (line < offside_lines.length) ::
    let cur = offside_lines[line]
    if (cur.content && indent >= cur.indent) ::
      break

    line++; last = cur
    if (innerIndent > cur.indent) ::
      innerIndent = cur.indent

  // cap to 
  innerIndent = first.indent > innerIndent
    ? first.indent : innerIndent

  return {op, innerIndent, first, last, nestInner}


pp.finishOffsideOp = function (op) ::
  let pos0 = this.state.pos
  if (op.extraChars)
    this.state.pos += op.extraChars

  this.finishToken(tt_offside[op.tokenPre])
  if (this.isLookahead) return

  let stack = this.state.offside
  let stackTop = stack[stack.length - 1]
  let blk = this.offsideBlock(op, stackTop)
  this.state.offside.push(blk)


pp.skipSpace = function() ::
  let stackTop, stack = this.state.offside
  if (stack && stack.length) ::
    stackTop = stack[stack.length-1]
    this.state.offsidePos = stackTop.last.posLastContent
  else this.state.offsidePos = -1

  try ::
    baseProto.skipSpace.call(this)
    this.state.offsidePos = -1
  catch (err) ::
    if (err !== offsideBreakout) throw err;


pp.readToken = function(code) ::
  if (this.state.pos !== this.state.offsidePos)
    return baseProto.readToken.call(this, code)

  return this.popOffside()

pp.popOffside = function() ::
  let stack = this.state.offside
  let stackTop = this.isLookahead
    ? stack[stack.length-1]
    : stack.pop()
  this.state.offsidePos = -1

  let tt_post = tt_offside[stackTop.op.tokenPost]
  this.finishToken(tt_post)
  return tt_post



const rx_offside = /^([ \t]*)(.*)$/mg
function parseOffsideIndexMap(input) ::
  let lines = [null], posLastContent=0, last=['', 0]

  let ans = input.replace @ rx_offside, (match, indent, content, pos) => ::
    if (!content) ::
      [indent, posLastContent] = last // blank line; use last valid content as end
    else ::
      // valid content; set last to current indent
      posLastContent = pos + match.length
      last = [indent, posLastContent]

    lines.push({line: lines.length, posLastContent, indent, content})
    return ''

  return lines



module.exports = exports = (babel) => @
  @{}
    manipulateOptions(opts, parserOpts) ::
      parserOpts.plugins.push('decorators', 'functionBind')


Object.assign @ exports,
  @{}
    hookBabylon,
    parseOffsideIndexMap,

