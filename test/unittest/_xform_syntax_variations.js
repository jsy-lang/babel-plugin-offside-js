const assert = require('assert')
const jsy_as_babel_ast = require('./_jsy_as_babel_ast')

function testSyntaxError(testCase) ::
  const block = () => ::
    if (testCase.debug) ::
      console.dir @ testCase.source, @{} colors: true, depth: null

    let res = jsy_as_babel_ast @ testCase.source

    if ('code' === testCase.debug) ::
      console.dir @ res.code.split('\n'), @{} colors: true, depth: null
    if ('ast' === testCase.debug) ::
      console.dir @ res.ast, @{} colors: true, depth: null

  assert.throws @ block, SyntaxError

function testSourceTransform(testCase) ::
  let res
  try ::
    if (testCase.debug) ::
      console.dir @ testCase.source, @{} colors: true, depth: null

    res = jsy_as_babel_ast @ testCase.source
  catch (err) ::
    console.error @ err
    assert.fail @ err.message

  if ('code' === testCase.debug) ::
    console.dir @ res.code.split('\n'), @{} colors: true, depth: null
  if ('ast' === testCase.debug) ::
    console.dir @ res.ast, @{} colors: true, depth: null

  if (testCase.tokens) ::
    const tokens = res.ast.tokens
      .map @ token => token.type.label
    assert.deepEqual @ tokens.pop(), 'eof'

    if ('tokens' === testCase.debug) ::
      console.log @ tokens
    const expected_tokens = Array.from(testCase.tokens)
      .filter @ token => token !== 'eof'
    assert.deepEqual @ tokens, expected_tokens


function genMochaSyntaxTestCases(iterSyntaxVariations, transformVariations) ::
  return @=> ::
    describe @ 'Basic', @=> genSyntaxTestCases @ it, iterSyntaxVariations()

    if transformVariations ::
      for const [name, xform] of Object.entries @ transformVariations ::
        describe @ name, @=> genSyntaxTestCases @ it, xform @ iterSyntaxVariations()


function genSyntaxTestCases(it, iterable_test_cases) ::
  for (const testCase of iterable_test_cases) ::
    let testFn, title=testCase.title
    if (testCase.expectSyntaxError) ::
      title += ' should THROW a syntax error'
      testFn = @=> testSyntaxError(testCase)
    else ::
      testFn = @=> testSourceTransform(testCase)

    if (testCase.only) ::
      it.only @ title, testFn
    else if (testCase.todo) ::
      it.todo @ title, testFn
    else ::
      it @ title, testFn

function bindIterableTransform(title_suffix, prefix, postfix, options={}) ::
  if 'string' !== typeof prefix ::
    throw new Error("Expected prefix to be a string")
  if postfix && 'string' !== typeof postfix ::
    options = postfix; postfix = null

  const indent = ' '.repeat @ options.indent || 2

  let pre_tokens = options.pre_tokens, post_tokens = options.post_tokens
  if !pre_tokens && options.tokens :: pre_tokens = tokens

  return function * (iterable_test_cases) ::
    for (const testCase of iterable_test_cases) ::
      const title = `${testCase.title} WITHIN ${title_suffix}`
      const source = [].concat @
        [prefix || '']
        testCase.source.map @ line => indent + line
        ['']
        [postfix || '']

      let tokens = null
      if testCase.tokens && (pre_tokens || post_tokens) ::
        tokens = [].concat @ pre_tokens || [], testCase.tokens || [], post_tokens || []

      yield Object.assign @ {}, testCase, @{} title, source, tokens


const blockTransforms = @{}
  inBlock: bindIterableTransform @ 'vanilla block', '{', '}',
    @{} pre_tokens: @[] '{'
        post_tokens: @[] '}'
  inOffsideBlock: bindIterableTransform @ 'offside block', '::',
    @{} pre_tokens: @[] '{'
        post_tokens: @[] '}'
  inIfBlock: bindIterableTransform @ 'keyword offside if block', 'if expr_0 ::',
    @{} pre_tokens: @[] 'if', '(', 'name', ')', '{'
        post_tokens: @[] '}'
  inWhileBlock: bindIterableTransform @ 'keyword offside while block', 'while expr_0 ::',
    @{} pre_tokens: @[] 'while', '(', 'name', ')', '{'
        post_tokens: @[] '}'
  inSwitchBlock: bindIterableTransform @ 'keyword offside switch block', 'switch expr_0 ::\n  case a: default:',
    @{} indent: 4
        pre_tokens: @[] 'switch', '(', 'name', ')', '{', 'case', 'name', ':', 'default', ':'
        post_tokens: @[] '}'
  inFinallyBlock: bindIterableTransform @ 'offside finally block', 'try ::\nfinally ::',
    @{} pre_tokens: @[] 'try', '{', '}', 'finally', '{'
        post_tokens: @[] '}'
  inTryFinallyBlock: bindIterableTransform @ 'offside try/finally block', 'try ::', 'finally ::',
    @{} pre_tokens: @[] 'try', '{'
        post_tokens: @[] '}', 'finally', '{', '}'
  inCatchBlock: bindIterableTransform @ 'keyword offside try/finally block', 'try ::\ncatch err ::',
    @{} pre_tokens: @[] 'try', '{', '}', 'catch', '(', 'name', ')', '{'
        post_tokens: @[] '}'
  inTryCatchBlock: bindIterableTransform @ 'offside try/catch block', 'try ::', 'catch (err) :: catchBlock',
    @{} pre_tokens: @[] 'try', '{'
        post_tokens: @[] '}', 'catch', '(', 'name', ')', '{', 'name', '}'
  inTryCatchBlock_v2: bindIterableTransform @ 'keyword offside try/catch block', 'try ::', 'catch err :: catchBlock',
    @{} pre_tokens: @[] 'try', '{'
        post_tokens: @[] '}', 'catch', '(', 'name', ')', '{', 'name', '}'

const functionTransforms = @{}
  inFunction: bindIterableTransform @ 'vanilla function', 'function outer_fn() {', '}',
    @{} pre_tokens: @[] 'function', 'name', '(', ')', '{'
        post_tokens: @[] '}'
  inOffsideFn: bindIterableTransform @ 'offside function', 'function outer_fn() ::',
    @{} pre_tokens: @[] 'function', 'name', '(', ')', '{'
        post_tokens: @[] '}'
  inArrowFn: bindIterableTransform @ 'vanilla arrow function', 'const outer_arrow = () => {', '}',
    @{} pre_tokens: @[] 'const', 'name', '=', '(', ')', '=>', '{'
        post_tokens: @[] '}'
  inOffsideArrowFn: bindIterableTransform @ 'offside arrow function', 'const outer_arrow = () => ::',
    @{} pre_tokens: @[] 'const', 'name', '=', '(', ')', '=>', '{'
        post_tokens: @[] '}'

const asyncFunctionTransforms = @{}
  inAsyncFunction: bindIterableTransform @ 'vanilla async function', 'async function outer_fn() {', '}',
    @{} pre_tokens: @[] 'name', 'function', 'name', '(', ')', '{'
        post_tokens: @[] '}'
  inOffsideAsyncFn: bindIterableTransform @ 'offside async function', 'async function outer_fn() ::',
    @{} pre_tokens: @[] 'name', 'function', 'name', '(', ')', '{'
        post_tokens: @[] '}'
  inAsyncArrowFn: bindIterableTransform @ 'vanilla arrow function', 'const outer_arrow = async () => {', '}',
    @{} pre_tokens: @[] 'const', 'name', '=', 'name', '(', ')', '=>', '{'
        post_tokens: @[] '}'
  inOffsideAsyncArrowFn: bindIterableTransform @ 'offside arrow function', 'const outer_arrow = async () => ::',
    @{} pre_tokens: @[] 'const', 'name', '=', 'name', '(', ')', '=>', '{'
        post_tokens: @[] '}'


const standardTransforms = Object.assign @ {},
  blockTransforms, functionTransforms, asyncFunctionTransforms

Object.assign @ exports, @{}
  genMochaSyntaxTestCases
  genSyntaxTestCases
  bindIterableTransform
  standardTransforms
  blockTransforms
  functionTransforms
  asyncFunctionTransforms
  testSourceTransform
  testSyntaxError

