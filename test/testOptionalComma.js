require('source-map-support').install()
const {genSyntaxTestCases, standardTransforms} = require('./_xform_syntax_variations')

const tap = require('tap-lite-tester')
tap.start()

genSyntaxTestCases @ tap, iterSyntaxVariations()
if 1 ::
  for let xform of Object.values @ standardTransforms ::
    genSyntaxTestCases @ tap, xform @ iterSyntaxVariations()

tap.finish()


function * iterSyntaxVariations() ::
  yield * iterCallArgumentVariations()
  yield * iterAdvancedCallMethods()
  yield * iterObjectMethods()

function * iterCallArgumentVariations() ::
  yield @: expectValid: true
    title: 'call arguments with implicit commas'
    source: @[]
      'method @'
      '    firstArg'
      '    secondArg'
      '    thirdArg'
    tokens: @[] 'name', '(', 'name', ',', 'name', ',', 'name', ')'

  yield @: expectValid: true
    title: 'call arguments mixed 1 with implicit commas'
    source: @[]
      'method @'
      '    firstArg, secondArg'
      '    thirdArg'
    tokens: @[] 'name', '(', 'name', ',', 'name', ',', 'name', ')'

  yield @: expectValid: true
    title: 'call arguments mixed 2 with implicit commas'
    source: @[]
      'method @'
      '    firstArg, secondArg, '
      '    thirdArg'
    tokens: @[] 'name', '(', 'name', ',', 'name', ',', 'name', ')'

  yield @: expectValid: true
    title: 'call arguments mixed 3 with implicit commas'
    source: @[]
      'method @'
      '    firstArg'
      '    secondArg, thirdArg'
    tokens: @[] 'name', '(', 'name', ',', 'name', ',', 'name', ')'

  yield @: expectValid: true
    title: 'call arguments mixed 4 with implicit commas'
    source: @[]
      'method @'
      '    firstArg'
      '    , secondArg'
      '    thirdArg'
    tokens: @[] 'name', '(', 'name', ',', 'name', ',', 'name', ')'


function * iterAdvancedCallMethods() ::
  yield @: expectValid: true
    title: 'advanced call methods -- simple with implicit commas, v1'
    source: @[]
      'method @'
      '  someValue'
      '  () => ::'
      '  otherValue'
      '  val =>'
      '    val + val'
      '  (err, cb) => ::'
    tokens: @[] 'name', '(', 'name', ',', '(', ')', '=>', '{', '}', ',', 'name', ',', 'name', '=>', 'name', '+/-', 'name', ',', '(', 'name', ',', 'name', ')', '=>', '{', '}', ')'

  yield @: expectValid: true
    title: 'advanced call methods -- simple with implicit commas, v2'
    source: @[]
      'method @'
      '  someValue'
      '  function () ::'
      '  otherValue'
      '  val =>'
      '    val + val'
      '  (err, cb) => ::'
    tokens: @[] 'name', '(', 'name', ',', 'function', '(', ')', '{', '}', ',', 'name', ',', 'name', '=>', 'name', '+/-', 'name', ',', '(', 'name', ',', 'name', ')', '=>', '{', '}', ')'

  yield @: expectValid: true
    title: 'advanced call methods -- simple with implicit commas, v3'
    source: @[]
      'method @'
      '  function () ::'
      '  val =>'
      '    val + val'
      '  (err, cb) => ::'
    tokens: @[] 'name', '(', 'function', '(', ')', '{', '}', ',', 'name', '=>', 'name', '+/-', 'name', ',', '(', 'name', ',', 'name', ')', '=>', '{', '}', ')'

  yield @: expectValid: true
    title: 'advanced call methods -- async with implicit commas, v1'
    source: @[]
      'method @'
      '  someValue'
      '  async function (p) ::'
      '    await p'
      '  otherValue'
      '  async (a, b) =>'
      '    await a + await b'
    tokens: @[] 'name', '(', 'name', ',', 'name', 'function', '(', 'name', ')', '{', 'name', 'name', '}', ',', 'name', ',', 'name', '(', 'name', ',', 'name', ')', '=>', 'name', 'name', '+/-', 'name', 'name', ')'

  yield @: expectValid: true
    title: 'advanced call methods -- async with implicit commas, v2'
    source: @[]
      'method @'
      '  async function (p) ::'
      '    await p'
      '  async (a, b) =>'
      '    await a + await b'
    tokens: @[] 'name', '(', 'name', 'function', '(', 'name', ')', '{', 'name', 'name', '}', ',', 'name', '(', 'name', ',', 'name', ')', '=>', 'name', 'name', '+/-', 'name', 'name', ')'

  yield @: expectValid: true
    title: 'advanced call methods -- generator with implicit commas, v1'
    source: @[]
      'method @'
      '  someValue'
      '  function * (iter) ::'
      '    yield * iter'
      '  otherValue'
      '  function * (a) ::'
      '    yield a'
      '    yield b'
    tokens: @[] 'name', '(', 'name', ',', 'function', '*', '(', 'name', ')', '{', 'yield', '*', 'name', '}', ',', 'name', ',', 'function', '*', '(', 'name', ')', '{', 'yield', 'name', 'yield', 'name', '}', ')'

  yield @: expectValid: true
    title: 'advanced call methods -- generator with implicit commas, v2'
    source: @[]
      'method @'
      '  function * (iter) ::'
      '    yield * iter'
      '  function * (a) ::'
      '    yield a'
      '    yield b'
    tokens: @[] 'name', '(', 'function', '*', '(', 'name', ')', '{', 'yield', '*', 'name', '}', ',', 'function', '*', '(', 'name', ')', '{', 'yield', 'name', 'yield', 'name', '}', ')'


function * iterObjectMethods() ::
  yield @: expectValid: true
    title: 'object methods -- simple with implicit commas'
    source: @[]
      'const api = @{}'
      '  someValue'
      '  method_a(a, b, c) ::'
      '  method_b() ::'
      '  method_c(d, e) ::'
      '  anotherValue'
    tokens: @[] 'const', 'name', '=', '{', 'name', ',', 'name', '(', 'name', ',', 'name', ',', 'name', ')', '{', '}', ',', 'name', '(', ')', '{', '}', ',', 'name', '(', 'name', ',', 'name', ')', '{', '}', ',', 'name', '}'

  yield @: expectValid: true
    title: 'object methods -- async with explicit comma'
    source: @[]
      'const api = @{}'
      '  method() ::'
      '  , async cps_method(p) ::'
      '    return await p'
    tokens: @[] 'const', 'name', '=', '{', 'name', '(', ')', '{', '}', ',', 'name', 'name', '(', 'name', ')', '{', 'return', 'name', 'name', '}', '}'

  yield @: expectValid: true
    title: 'object methods -- async with implicit comma'
    source: @[]
      'const api = @{}'
      '  method() ::'
      '  async cps_method(p) ::'
      '    return await p'
    tokens: @[] 'const', 'name', '=', '{', 'name', '(', ')', '{', '}', ',', 'name', 'name', '(', 'name', ')', '{', 'return', 'name', 'name', '}', '}'

  yield @: expectValid: true
    title: 'object methods -- generator with explicit comma'
    source: @[]
      'const api = @{}'
      '  method() ::'
      '  , * iter_method(iterable) ::'
      '    yield * iterable'
    tokens: @[] 'const', 'name', '=', '{', 'name', '(', ')', '{', '}', ',', '*', 'name', '(', 'name', ')', '{', 'yield', '*', 'name', '}', '}'

  yield @: expectValid: true
    title: 'object methods -- generator with implicit comma'
    source: @[]
      'const api = @{}'
      '  method() ::'
      '  * iter_method(iterable) ::'
      '    yield * iterable'
    tokens: @[] 'const', 'name', '=', '{', 'name', '(', ')', '{', '}', ',', '*', 'name', '(', 'name', ')', '{', 'yield', '*', 'name', '}', '}'

