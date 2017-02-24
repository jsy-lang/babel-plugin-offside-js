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
  yield * iterTryFinally()
  yield * iterTryCatch()

function * iterTryFinally() ::
  // try / finally variations
  yield :: expectValid: true
    , title: 'vanilla try/finally statement'
    , source: @[] 'try { blockStatement } finally { blockStatement }'
    , tokens: @[] 'try', '{', 'name', '}', 'finally', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'offside try/finally statement'
    , source: @[] 'try ::'
                , '  blockStatement'
                , 'finally ::'
                , '  blockStatement'
    , tokens: @[] 'try', '{', 'name', '}', 'finally', '{', 'name', '}', 'eof'


function * iterTryCatch() ::
  // try / catch (expr) variations
  yield :: expectValid: true
    , title: 'vanilla try/catch statement'
    , source: @[] 'try { blockStatement } catch (err) { blockStatement }'
    , tokens: @[] 'try', '{', 'name', '}', 'catch', '(', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'offside try/catch statement'
    , source: @[] 'try ::'
                , '  blockStatement'
                , 'catch (err) ::'
                , '  blockStatement'
    , tokens: @[] 'try', '{', 'name', '}', 'catch', '(', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword offside try/catch statement'
    , source: @[] 'try ::'
                , '  blockStatement'
                , 'catch err ::'
                , '  blockStatement'
    , tokens: @[] 'try', '{', 'name', '}', 'catch', '(', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword @ offside try/catch statement'
    , source: @[] 'try ::'
                , '  blockStatement'
                , 'catch @ err ::'
                , '  blockStatement'
    , tokens: @[] 'try', '{', 'name', '}', 'catch', '(', 'name', ')', '{', 'name', '}', 'eof'
