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
  yield * iterPromiseCatch()
  yield * iterHashCatchFn()
  yield * iterTernaryExpressions()


function * iterPromiseCatch() ::
  // catch keyword after promise-- promise.catch @ err => err
  yield :: expectValid: true
    , title: 'promise.catch vanilla'
    , source: @[] 'promise.catch(err => err)'
    , tokens: @[] 'name', '.', 'catch', '(', 'name', '=>', 'name', ')'

  yield :: expectValid: true
    , title: 'promise.catch offside arrow expression'
    , source: @[] 'promise.catch @ err => err'
    , tokens: @[] 'name', '.', 'catch', '(', 'name', '=>', 'name', ')'

  yield :: expectValid: true
    , title: 'promise.catch offside arrow block'
    , source: @[] 'promise.catch @ err => :: err'
    , tokens: @[] 'name', '.', 'catch', '(', 'name', '=>', '{', 'name', '}', ')'


function * iterHashCatchFn() ::
  // catch keyword within hash -- {catch: err => err}
  yield :: expectValid: true
    , title: 'hash (vanilla) with catch entry arrow expression'
    , source: @[] 'const ns = {catch: err => err}'
    , tokens: @[] 'const', 'name', '=', '{', 'catch', ':', 'name', '=>', 'name', '}'

  yield :: expectValid: true
    , title: 'hash (offside) with catch entry arrow expression'
    , source: @[] 'const ns = @{} catch: err => err'
    , tokens: @[] 'const', 'name', '=', '{', 'catch', ':', 'name', '=>', 'name', '}'

  yield :: expectValid: true
    , title: 'hash (offside) with catch entry arrow block'
    , source: @[] 'const ns = @{} catch: err => :: err'
    , tokens: @[] 'const', 'name', '=', '{', 'catch', ':', 'name', '=>', '{', 'name', '}', '}'

  yield :: expectValid: true
    , title: 'hash (offside) with catch function'
    , source: @[] 'const ns = @{} catch(err) :: '
    , tokens: @[] 'const', 'name', '=', '{', 'catch', '(', 'name', ')', '{', '}', '}'

function * iterTernaryExpressions() ::
  yield :: expectValid: true
    , title: 'ternary with @ on second branch'
    , source: @[] 'const ans = test'
                , '  ? first'
                , '  : @ second'
    , tokens: @[] 'const', 'name', '=', 'name', '?', 'name', ':', '(', 'name', ')'

  yield :: expectValid: true
    , title: 'ternary with @ on first branch'
    , source: @[] 'const ans = test'
                , '  ? @ first'
                , '  : second'
    , tokens: @[] 'const', 'name', '=', 'name', '?', '(', 'name', ')', ':', 'name'

  yield :: expectValid: true
    , title: 'ternary with @ on both branchs'
    , source: @[] 'const ans = test'
                , '  ? @ first'
                , '  : @ second'
    , tokens: @[] 'const', 'name', '=', 'name', '?', '(', 'name', ')', ':', '(', 'name', ')'


  // Test with @{}
  yield :: expectValid: true
    , title: 'ternary with @{} on second branch'
    , source: @[] 'const ans = test'
                , '  ? first'
                , '  : @{} second'
                , '     , second_part_b'
    , tokens: @[] 'const', 'name', '=', 'name', '?', 'name', ':', '{', 'name', ',', 'name', '}'

  yield :: expectValid: true
    , title: 'ternary with @{} on first branch'
    , source: @[] 'const ans = test'
                , '  ? @{} first'
                , '     , first_part_b'
                , '  : second'
    , tokens: @[] 'const', 'name', '=', 'name', '?', '{', 'name', ',', 'name', '}', ':', 'name'

  yield :: expectValid: true
    , title: 'ternary with @{} on both branchs'
    , source: @[] 'const ans = test'
                , '  ? @{} first'
                , '     , first_part_b'
                , '  : @{} second'
                , '     , second_part_b'
    , tokens: @[] 'const', 'name', '=', 'name', '?', '{', 'name', ',', 'name', '}', ':', '{', 'name', ',', 'name', '}'


  // Test with @:
  yield :: expectValid: true
    , title: 'ternary with @: on second branch'
    , source: @[] 'const ans = test'
                , '  ? first'
                , '  : @: second'
                , '     , second_part_b'
    , tokens: @[] 'const', 'name', '=', 'name', '?', 'name', ':', '(', '{', 'name', ',', 'name', '}', ')'

  yield :: expectValid: true
    , title: 'ternary with @: on first branch'
    , source: @[] 'const ans = test'
                , '  ? @: first'
                , '     , first_part_b'
                , '  : second'
    , tokens: @[] 'const', 'name', '=', 'name', '?', '(', '{', 'name', ',', 'name', '}', ')', ':', 'name'

  yield :: expectValid: true
    , title: 'ternary with @: on both branchs'
    , source: @[] 'const ans = test'
                , '  ? @: first'
                , '     , first_part_b'
                , '  : @: second'
                , '     , second_part_b'
    , tokens: @[] 'const', 'name', '=', 'name', '?', '(', '{', 'name', ',', 'name', '}', ')', ':', '(', '{', 'name', ',', 'name', '}', ')'


  // Test with @[]
  yield :: expectValid: true
    , title: 'ternary with @[] on second branch'
    , source: @[] 'const ans = test'
                , '  ? first'
                , '  : @[] second'
                , '     , second_part_b'
    , tokens: @[] 'const', 'name', '=', 'name', '?', 'name', ':', '[', 'name', ',', 'name', ']'

  yield :: expectValid: true
    , title: 'ternary with @[] on first branch'
    , source: @[] 'const ans = test'
                , '  ? @[] first'
                , '     , first_part_b'
                , '  : second'
    , tokens: @[] 'const', 'name', '=', 'name', '?', '[', 'name', ',', 'name', ']', ':', 'name'

  yield :: expectValid: true
    , title: 'ternary with @[] on both branchs'
    , source: @[] 'const ans = test'
                , '  ? @[] first'
                , '     , first_part_b'
                , '  : @[] second'
                , '     , second_part_b'
    , tokens: @[] 'const', 'name', '=', 'name', '?', '[', 'name', ',', 'name', ']', ':', '[', 'name', ',', 'name', ']'


  // Test with @#
  yield :: expectValid: true
    , title: 'ternary with @# on second branch'
    , source: @[] 'const ans = test'
                , '  ? first'
                , '  : @# second'
                , '     , second_part_b'
    , tokens: @[] 'const', 'name', '=', 'name', '?', 'name', ':', '(', '[', 'name', ',', 'name', ']', ')'

  yield :: expectValid: true
    , title: 'ternary with @# on first branch'
    , source: @[] 'const ans = test'
                , '  ? @# first'
                , '     , first_part_b'
                , '  : second'
    , tokens: @[] 'const', 'name', '=', 'name', '?', '(', '[', 'name', ',', 'name', ']', ')', ':', 'name'

  yield :: expectValid: true
    , title: 'ternary with @# on both branchs'
    , source: @[] 'const ans = test'
                , '  ? @# first'
                , '     , first_part_b'
                , '  : @# second'
                , '     , second_part_b'
    , tokens: @[] 'const', 'name', '=', 'name', '?', '(', '[', 'name', ',', 'name', ']', ')', ':', '(', '[', 'name', ',', 'name', ']', ')'
