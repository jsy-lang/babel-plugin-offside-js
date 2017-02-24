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
  // switch (expr) :: cases variations
  yield :: expectValid: true
    , title: 'vanilla switch statement'
    , source: @[] 'switch (expr) { case a: default: break }'
    , tokens: @[] 'switch', '(', 'name', ')', '{', 'case', 'name', ':', 'default', ':', 'break', '}', 'eof'

  yield :: expectValid: true
    , title: 'offside switch statement'
    , source: @[] 'switch (expr) :: case a: default: break'
    , tokens: @[] 'switch', '(', 'name', ')', '{', 'case', 'name', ':', 'default', ':', 'break', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword offside switch statement'
    , source: @[] 'switch expr :: case a: default: break'
    , tokens: @[] 'switch', '(', 'name', ')', '{', 'case', 'name', ':', 'default', ':', 'break', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword @ offside switch statement'
    , source: @[] 'switch @ expr :: case a: default: break'
    , tokens: @[] 'switch', '(', 'name', ')', '{', 'case', 'name', ':', 'default', ':', 'break', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword offside switch statement with call'
    , source: @[] 'switch fn_call @ x, y :: case a: default: break'
    , tokens: @[] 'switch', '(', 'name', '(', 'name', ',', 'name', ')', ')', '{', 'case', 'name', ':', 'default', ':', 'break', '}', 'eof'

   

