import {offsideOperatorsForBabylon, parseOffsideIndexMap} from './offside_ops'

export function hookBabylon(babylon) ::
  // abuse Babylon token updateContext callback extract
  // the reference to Parser

  let Parser
  const tgt_patch = babylon.tokTypes.braceL
  const fn_updateContext = tgt_patch.updateContext
  tgt_patch.updateContext = function (prevType) ::
    tgt_patch.updateContext = fn_updateContext
    Parser = this.constructor

  babylon.parse('{}')
  if ! Parser ::
    throw new Error @ "Failed to hook Babylon Parser"
  return Parser


export function installOffsideBabylonParsers() ::
  const hookList = []

  try :: hookList.push @
    require('babylon')
  catch err ::

  try :: hookList.push @
    require('babel-cli/node_modules/babylon')
  catch err ::

  try :: hookList.push @
    require('babel-core/node_modules/babylon')
  catch err ::

  if 0 === hookList.length ::
    throw new Error @ `Unable to load "babylon" parser package`

  return hookList.map @ babylon =>
    asOffsideJSBabylonParser(babylon)
  

export function asOffsideJSBabylonParser(babylon)
{ // begin per-babylon instance monkeypatching

const Parser = hookBabylon(babylon)
const baseProto = Parser.prototype
const pp = Parser.prototype = Object.create(baseProto)
const tt = babylon.tokTypes

const at_offside = offsideOperatorsForBabylon(tt)

var _g_offsidePluginOpts

const _base_module_parse = babylon.parse
babylon.parse = (input, options) => ::
  _g_offsidePluginOpts = options ? options.offsidePluginOpts : undefined
  return _base_module_parse(input, options)


pp._base_parse = baseProto.parse
pp.parse = function() ::
  this.initOffside()
  return this._base_parse()


class OffsideBreakout extends Error {}
const offsideBreakout = new OffsideBreakout()

pp.initOffside = function() ::
  this.state.offside = []
  this.state.offsideNextOp = null
  this.state.offsideTokenStack = []
  this.offside_lines = parseOffsideIndexMap(this.input)
  this.offsidePluginOpts = _g_offsidePluginOpts || {}
  _g_offsidePluginOpts = null

  this.state._pos = this.state.pos
  Object.defineProperty @ this.state, 'pos', @{}
    enumerable: true
    get() :: return this._pos
    set(pos) ::
      // interrupt skipSpace algorithm when we hit our position 'breakpoint'
      const offPos = this.offsidePos
      if offPos>=0 && (pos > offPos) ::
        throw offsideBreakout

      this._pos = pos


const tt_offside_keyword_with_args = new Set @#
      tt._if, tt._while, tt._for
      tt._catch, tt._switch

const tt_offside_keyword_lookahead_skip = new Set @#
      tt.parenL, tt.colon, tt.comma, tt.dot

pp.isForAwait = function (keywordType, type, val) ::
  return tt._for === keywordType
    && tt.name === type
    && 'await' === val

const rx_offside_op = /(\S+)[ \t]*(\r\n|\r|\n)?/

pp.finishTokenStack = function(tokenOrList) ::
  if Array.isArray(tokenOrList) ::
    this.state.offsideTokenStack = tokenOrList.slice(1)
    tokenOrList = tokenOrList[0]

  return this._base_finishToken(tokenOrList)

pp._base_finishToken = baseProto.finishToken
pp.finishToken = function(type, val) ::
  const state = this.state
  const recentKeyword = state.offsideRecentKeyword
  const inForAwait = recentKeyword ? this.isForAwait(recentKeyword, type, val) : null
  state.offsideRecentKeyword = null

  if tt_offside_keyword_with_args.has(type) || inForAwait ::
    const isKeywordAllowed = !this.isLookahead
      && tt.dot !== state.type

    if !isKeywordAllowed ::
      return this._base_finishToken(type, val)

    state.offsideRecentKeyword = inForAwait ? tt._for : type
    const lookahead = this.lookahead()

    if tt_offside_keyword_lookahead_skip.has(lookahead.type) ::
    else if this.isForAwait(type, lookahead.type, lookahead.value) ::
    else ::
      state.offsideNextOp = at_offside.keyword_args

    return this._base_finishToken(type, val)

  if type === tt.at || type === tt.doubleColon ::
    const pos0 = state.start
    const m_op = rx_offside_op.exec @ this.input.slice(pos0)
    const str_op = m_op[1]
    const lineEndsWithOp = !! m_op[2]

    let op = at_offside[str_op]
    if op ::
      if op.keywordBlock && recentKeyword && tt_offside_keyword_with_args.has(recentKeyword) ::
        op = at_offside.keyword_args

      else if lineEndsWithOp && op.nestInner::
        // all offside operators at the end of a line implicitly don't nestInner
        op = @{} __proto__: op, nestInner: false

      this.finishOffsideOp(op, op.extraChars)

      if op.nestOp ::
        state.offsideNextOp = at_offside[op.nestOp]
      return

  if tt.eof === type ::
    if state.offside.length ::
      return this.popOffside()

  return this._base_finishToken(type, val)


pp.offsideIndent = function (line0, outerIndent, innerIndent) ::
  const offside_lines = this.offside_lines

  if null == innerIndent ::
    const innerLine = offside_lines[line0+1]
    innerIndent = innerLine ? innerLine.indent : ''

  let line=line0+1, last=offside_lines[line0]
  while line < offside_lines.length ::
    const cur = offside_lines[line]
    if cur.content && outerIndent >= cur.indent ::
      line-- // backup to previous line
      break

    line++; last = cur
    if false === innerIndent ::
      innerIndent = cur.indent
    else if innerIndent > cur.indent ::
      innerIndent = cur.indent

  return @{} line, last, innerIndent


pp.offsideBlock = function (op, stackTop, recentKeywordTop) ::
  const state = this.state
  const line0 = state.curLine
  const first = this.offside_lines[line0]

  let indent, keywordNestedIndent
  if recentKeywordTop ::
    indent = recentKeywordTop.first.indent
  else if op.nestInner && stackTop && line0 === stackTop.first.line ::
    indent = stackTop.innerIndent
  else if op.inKeywordArg ::
    indent = first.indent
    const indent_block = this.offsideIndent(line0, indent)
    const indent_keyword = this.offsideIndent(line0, indent_block.innerIndent)
    if indent_keyword.innerIndent > indent_block.innerIndent ::
      // autodetect keyword argument using '@' for function calls
      indent = indent_block.innerIndent
      keywordNestedIndent = indent_keyword.innerIndent
  else ::
    indent = first.indent

  let {last, innerIndent} = this.offsideIndent(line0, indent, keywordNestedIndent)

  // cap to 
  innerIndent = first.indent > innerIndent
    ? first.indent : innerIndent

  if stackTop && stackTop.last.posLastContent < last.posLastContent::
    // Fixup enclosing scopes. Happens in situations like: `server.on @ wraper @ (...args) => ::`
    const stack = state.offside
    for let idx = stack.length-1; idx>0; idx-- ::
      let tip = stack[idx]
      if tip.last.posLastContent >= last.posLastContent :: break
      tip.last = last

  return @{} op, innerIndent, first, last
      start: state.start, end: state.end
      loc: @{} start: state.startLoc, end: state.endLoc



pp.finishOffsideOp = function (op, extraChars) ::
  const stack = this.state.offside
  let stackTop = stack[stack.length - 1]
  let recentKeywordTop
  if op.codeBlock ::
    if stackTop && stackTop.inKeywordArg ::
      // We're at the end of an offside keyword block; restore enclosing ()
      this.popOffside()
      this.state.offsideNextOp = op
      this.state.offsideRecentTop = stackTop
      return

    recentKeywordTop = this.state.offsideRecentTop
    this.state.offsideRecentTop = null

  if extraChars ::
    this.state.pos += extraChars

  this.finishTokenStack(op.tokenPre)

  if this.isLookahead :: return

  stackTop = stack[stack.length - 1]
  const blk = this.offsideBlock(op, stackTop, recentKeywordTop)
  blk.inKeywordArg = op.inKeywordArg || stackTop && stackTop.inKeywordArg
  this.state.offside.push(blk)


pp._base_skipSpace = baseProto.skipSpace
pp.skipSpace = function() ::
  const state = this.state
  if null !== state.offsideNextOp :: return

  const stack = state.offside
  let stackTop
  if stack && stack.length ::
    stackTop = stack[stack.length-1]
    state.offsidePos = stackTop.last.posLastContent
  else :: state.offsidePos = -1

  try ::
    this._base_skipSpace()
    state.offsidePos = -1

    state.offsideImplicitComma = undefined !== stackTop
      ? this.offsideCheckImplicitComma(stackTop)
      : null
  catch err ::
    if err !== offsideBreakout :: throw err


const tt_offside_disrupt_implicit_comma = new Set @#
  tt.comma, tt.dot, tt.arrow, tt.colon, tt.semi, tt.question

pp.offsideCheckImplicitComma = function(stackTop) ::
  const {implicitCommas} = stackTop.op
  if ! implicitCommas ::
    return null // not enabled for this offside op
  if ! this.offsidePluginOpts.implicit_commas ::
    return null // not enabled for this offside op

  const state = this.state, state_type=state.type, column = state.pos - state.lineStart
  if column !== stackTop.innerIndent.length ::
    return null // not at the exact right indent
  if stackTop.end >= state.end ::
    return false // no comma before the first element
  if tt.comma === state_type ::
    return false // there's an explicit comma already present
  if state_type.binop || state_type.beforeExpr ::
    return false // there's an operator or arrow function preceeding this line

  if this.isLookahead :: return false // disallow recursive lookahead
  const {type: next_type} = this.lookahead()

  if tt_offside_disrupt_implicit_comma.has(next_type) ::
    return false // there's a comma, dot, or function arrow token that precludes an implicit leading comma
  if next_type.binop ::
    if 'function' === typeof implicitCommas.has ::
      // allow for tt.star in certain contexts — e.g. for generator method defintions
      return implicitCommas.has(next_type)

    return false // there's a binary operator that precludes an implicit leading comma
  else ::
    return true // an implicit comma is needed

pp._base_readToken = baseProto.readToken
pp.readToken = function(code) ::
  const state = this.state

  if state.offsideTokenStack.length ::
    const head = state.offsideTokenStack.shift()
    if 'string' === typeof head ::
      return this._base_finishToken(tt.name, head)
    else return this._base_finishToken(head)

  if state.offsideImplicitComma ::
    return this._base_finishToken(tt.comma)

  const offsideNextOp = state.offsideNextOp
  if null !== offsideNextOp ::
    state.offsideNextOp = null
    return this.finishOffsideOp(offsideNextOp)

  if state.pos === state.offsidePos ::
    return this.popOffside()

  return this._base_readToken(code)

pp.popOffside = function() ::
  const stack = this.state.offside
  const stackTop = this.isLookahead
    ? stack[stack.length-1]
    : stack.pop()
  this.state.offsidePos = -1

  this.finishTokenStack(stackTop.op.tokenPost)
  return stackTop


return Parser
} // end per-babylon instance monkeypatching
