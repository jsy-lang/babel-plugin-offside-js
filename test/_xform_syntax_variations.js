const path = require('path')
const babel = require('babel-core')

const babel_opt =
  @{} babelrc: false
    , highlightCode: false
    , plugins: @[]
        @[] path.resolve(__dirname, '../dist/')
          , @{} demo_options: 2142, keyword_blocks: true


function testSyntaxError(t, testCase) ::
  const block = () => ::
    if (testCase.debug) ::
      console.dir @ testCase.source, @{} colors: true, depth: null

    let res = babel.transform(testCase.source.join('\n'), babel_opt)

    if ('code' === testCase.debug) ::
      console.dir @ res.code.split('\n'), @{} colors: true, depth: null
    if ('ast' === testCase.debug) ::
      console.dir @ res.ast, @{} colors: true, depth: null

  t.throws @ block, SyntaxError

function testSourceTransform(t, testCase) ::
  let res
  try ::
    if (testCase.debug) ::
      console.dir @ testCase.source, @{} colors: true, depth: null

    res = babel.transform(testCase.source.join('\n'), babel_opt)
  catch (err) ::
    console.error @ err
    t.fail @ err.message

  if ('code' === testCase.debug) ::
    console.dir @ res.code.split('\n'), @{} colors: true, depth: null
  if ('ast' === testCase.debug) ::
    console.dir @ res.ast, @{} colors: true, depth: null

  if (testCase.tokens) ::
    const tokens = res.ast.tokens
      .map @ token => token.type.label
    if ('tokens' === testCase.debug) ::
      console.log @ tokens
    t.deepEqual @ tokens, testCase.tokens


function genSyntaxTestCases(tap, iterable_test_cases) ::
  for (const testCase of iterable_test_cases) ::
    let testFn, title=testCase.title
    if (testCase.expectSyntaxError) ::
      title += ' should THROW a syntax error'
      testFn = t => testSyntaxError(t, testCase)
    else ::
      testFn = t => testSourceTransform(t, testCase)

    if (testCase.only) ::
      tap.only @ title, testFn
    else if (testCase.todo) ::
      tap.todo @ title, testFn
    else ::
      tap.test @ title, testFn

function bindIterableTransform(title_suffix, prefix, postfix, indent=2) ::
  indent = ' '.repeat @ indent
  return function * (iterable_test_cases) ::
    for (let testCase of iterable_test_cases) ::
      const title = `${testCase.title} WITHIN ${title_suffix}`
      const source = [].concat @
          [prefix || '']
        , testCase.source.map @ line => indent + line
        , ['']
        , [postfix || '']

      yield Object.assign @ {}, testCase, @{} title, source, tokens: null

const standardTransforms = ::
    inBlock: bindIterableTransform @ 'vanilla block', '{', '}'
  , inOffsideBlock: bindIterableTransform @ 'offside block', '::'
  , inFunction: bindIterableTransform @ 'vanilla function', 'function outer_fn() {', '}'
  , inOffsideFn: bindIterableTransform @ 'offside function', 'function outer() ::'
  , inArrowFn: bindIterableTransform @ 'vanilla arrow function', 'const outer_arrow = () => {', '}'
  , inOffsideArrowFn: bindIterableTransform @ 'offside arrow function', 'const outer_arrow = () => ::'
  , inIfBlock: bindIterableTransform @ 'keyword offside if block', 'if expr_0 ::'
  , inWhileBlock: bindIterableTransform @ 'keyword offside while block', 'while expr_0 ::'
  , inSwitchBlock: bindIterableTransform @ 'keyword offside switch block', 'switch expr_0 ::\n  case a: default:', '', 4

  , inFinallyBlock: bindIterableTransform @ 'offside finally block', 'try ::\nfinally ::'
  , inTryFinallyBlock: bindIterableTransform @ 'offside try/finally block', 'try ::', 'finally ::'
  , inCatchBlock: bindIterableTransform @ 'keyword offside try/finally block', 'try ::\ncatch err ::'
  , inTryCatchBlock: bindIterableTransform @ 'offside try/catch block', 'try ::', 'catch (err) ::'

  // TODO: Investigate while the following causes errors
  //, inTryCatchBlock_v2: bindIterableTransform @ 'keyword offside try/catch block', 'try ::', 'catch err ::'

const extendedTransforms = ::

Object.assign @ exports,
  @{} babel_opt
    , genSyntaxTestCases
    , bindIterableTransform
    , standardTransforms
    , testSourceTransform
    , testSyntaxError

