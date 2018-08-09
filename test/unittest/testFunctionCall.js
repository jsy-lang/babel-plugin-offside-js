require('source-map-support').install()

const {genMochaSyntaxTestCases, standardTransforms} = require('./_xform_syntax_variations')
describe @ 'Function Call Statements',
  genMochaSyntaxTestCases @ iterSyntaxVariations, standardTransforms




function * iterSyntaxVariations() ::
  yield * iterCalls()
  yield * iterArrayCalls()
  yield * iterHashCalls()
  yield * iterArrowCalls()
  yield * iterArrowAsyncCalls()

function * iterCalls() ::
  yield @{} expectValid: true
    title: 'simple call 0 args single line'
    source: @[] 'fn_target @'
    tokens: @[] 'name', '(', ')'

  yield @{} expectValid: true
    title: 'simple call 1 arg single line'
    source: @[] 'fn_target @ one'
    tokens: @[] 'name', '(', 'name', ')'

  yield @{} expectValid: true
    title: 'simple call 2 args single line'
    source: @[] 'fn_target @ one, two'
    tokens: @[] 'name', '(', 'name', ',', 'name', ')'


  yield @{} expectValid: true
    title: 'simple call 0 args multiple lines'
    source: @[]
      'fn_target @'
      ''
    tokens: @[] 'name', '(', ')'

  yield @{} expectValid: true
    title: 'simple call 1 arg multiple lines'
    source: @[] 'fn_target @ one'
    source: @[]
      'fn_target @'
      '  one'
    tokens: @[] 'name', '(', 'name', ')'

  yield @{} expectValid: true
    title: 'simple call 2 args multiple lines'
    source: @[]
      'fn_target @'
      '  one'
      '  two'
    tokens: @[] 'name', '(', 'name', ',', 'name', ')'


function * iterHashCalls() ::
  yield @{} expectValid: true
    title: 'call with hash 0 args single line'
    source: @[] 'fn_target @:', ''
    tokens: @[] 'name', '(', '{', '}', ')'

  yield @{} expectValid: true
    title: 'call with hash 1 arg single line'
    source: @[] 'fn_target @: one'
    tokens: @[] 'name', '(', '{', 'name', '}', ')'

  yield @{} expectValid: true
    title: 'call with hash 2 args single line'
    source: @[] 'fn_target @: one, two'
    tokens: @[] 'name', '(', '{', 'name', ',', 'name', '}', ')'


  yield @{} expectValid: true
    title: 'call with hash 0 args multiple lines'
    source: @[]
      'fn_target @:'
      ''
    tokens: @[] 'name', '(', '{', '}', ')'

  yield @{} expectValid: true
    title: 'call with hash 1 arg multiple lines'
    source: @[] 'fn_target @: one'
    source: @[]
      'fn_target @:'
      '  one'
    tokens: @[] 'name', '(', '{', 'name', '}', ')'

  yield @{} expectValid: true
    title: 'call with hash 2 args multiple lines'
    source: @[]
      'fn_target @:'
      '  one'
      '  two'
    tokens: @[] 'name', '(', '{', 'name', ',', 'name', '}', ')'


function * iterArrayCalls() ::
  yield @{} expectValid: true
    title: 'call with array 0 args single line'
    source: @[] 'fn_target @#', ''
    tokens: @[] 'name', '(', '[', ']', ')'

  yield @{} expectValid: true
    title: 'call with array 1 arg single line'
    source: @[] 'fn_target @# one'
    tokens: @[] 'name', '(', '[', 'name', ']', ')'

  yield @{} expectValid: true
    title: 'call with array 2 args single line'
    source: @[] 'fn_target @# one, two'
    tokens: @[] 'name', '(', '[', 'name', ',', 'name', ']', ')'


  yield @{} expectValid: true
    title: 'call with array 0 args multiple lines'
    source: @[]
      'fn_target @#'
      ''
    tokens: @[] 'name', '(', '[', ']', ')'

  yield @{} expectValid: true
    title: 'call with array 1 arg multiple lines'
    source: @[] 'fn_target @# one'
    source: @[]
      'fn_target @#'
      '  one'
    tokens: @[] 'name', '(', '[', 'name', ']', ')'

  yield @{} expectValid: true
    title: 'call with array 2 args multiple lines'
    source: @[]
      'fn_target @#'
      '  one'
      '  two'
    tokens: @[] 'name', '(', '[', 'name', ',', 'name', ']', ')'


function * iterArrowCalls() ::
  yield @{} expectValid: true
    title: 'vanilla call arrow with single line'
    source: @[] 'fn_target @ () => value'
    tokens: @[] 'name', '(', '(', ')', '=>', 'name', ')'

  yield @{} expectValid: true
    title: 'call arrow with single line expression'
    source: @[] 'fn_target @=> value'
    tokens: @[] 'name', '(', '(', ')', '=>', 'name', ')'

  yield @{} expectValid: true
    title: 'call arrow with multiple line expression'
    source: @[]
      'fn_target @=>'
      '  value'
    tokens: @[] 'name', '(', '(', ')', '=>', 'name', ')'

  yield @{} expectValid: true
    title: 'call arrow with single line vanilla body'
    source: @[] 'fn_target @=> { value }'
    tokens: @[] 'name', '(', '(', ')', '=>', '{', 'name', '}', ')'

  yield @{} expectValid: true
    title: 'call arrow with single line body'
    source: @[] 'fn_target @=> :: value'
    tokens: @[] 'name', '(', '(', ')', '=>', '{', 'name', '}', ')'

  yield @{} expectValid: true
    title: 'call arrow with multiple line body'
    source: @[]
      'fn_target @=> ::'
      '  value'
      '  second'
    tokens: @[] 'name', '(', '(', ')', '=>', '{', 'name', 'name', '}', ')'

  yield @{} expectValid: true
    title: 'call arrow with multiple line paren expression'
    source: @[]
      'fn_target @=> @'
      '  value'
      '  second'
    tokens: @[] 'name', '(', '(', ')', '=>', '(', 'name', ',', 'name', ')', ')'

  yield @{} expectValid: true
    title: 'call arrow with multiple line hash expression'
    source: @[]
      'fn_target @=> @:'
      '  value'
      '  second'
    tokens: @[] 'name', '(', '(', ')', '=>', '(', '{', 'name', ',', 'name', '}', ')', ')'

  yield @{} expectValid: true
    title: 'call arrow with multiple line array expression'
    source: @[]
      'fn_target @=> @#'
      '  value'
      '  second'
    tokens: @[] 'name', '(', '(', ')', '=>', '(', '[', 'name', ',', 'name', ']', ')', ')'


function * iterArrowAsyncCalls() ::
  yield @{} expectValid: true
    title: 'vanilla call async arrow with single line'
    source: @[] 'fn_target @ async () => value'
    tokens: @[] 'name', '(', 'name', '(', ')', '=>', 'name', ')'

  yield @{} expectValid: true
    title: 'call async arrow with single line expression'
    source: @[] 'fn_target @=>> value'
    tokens: @[] 'name', '(', 'name', '(', ')', '=>', 'name', ')'

  yield @{} expectValid: true
    title: 'call async arrow with multiple line expression'
    source: @[]
      'fn_target @=>>'
      '  value'
    tokens: @[] 'name', '(', 'name', '(', ')', '=>', 'name', ')'

  yield @{} expectValid: true
    title: 'call async arrow with single line vanilla body'
    source: @[] 'fn_target @=>> { value }'
    tokens: @[] 'name', '(', 'name', '(', ')', '=>', '{', 'name', '}', ')'

  yield @{} expectValid: true
    title: 'call async arrow with single line body'
    source: @[] 'fn_target @=>> :: value'
    tokens: @[] 'name', '(', 'name', '(', ')', '=>', '{', 'name', '}', ')'

  yield @{} expectValid: true
    title: 'call async arrow with multiple line body'
    source: @[]
      'fn_target @=>> ::'
      '  value'
      '  second'
    tokens: @[] 'name', '(', 'name', '(', ')', '=>', '{', 'name', 'name', '}', ')'

  yield @{} expectValid: true
    title: 'call async arrow with multiple line paren expression'
    source: @[]
      'fn_target @=>> @'
      '  value'
      '  second'
    tokens: @[] 'name', '(', 'name', '(', ')', '=>', '(', 'name', ',', 'name', ')', ')'

  yield @{} expectValid: true
    title: 'call async arrow with multiple line hash expression'
    source: @[]
      'fn_target @=>> @:'
      '  value'
      '  second'
    tokens: @[] 'name', '(', 'name', '(', ')', '=>', '(', '{', 'name', ',', 'name', '}', ')', ')'

  yield @{} expectValid: true
    title: 'call async arrow with multiple line array expression'
    source: @[]
      'fn_target @=>> @#'
      '  value'
      '  second'
    tokens: @[] 'name', '(', 'name', '(', ')', '=>', '(', '[', 'name', ',', 'name', ']', ')', ')'

