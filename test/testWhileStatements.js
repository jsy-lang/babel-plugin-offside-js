require('source-map-support').install()
const {genSyntaxTestCases, standardTransforms} = require('./_xform_syntax_variations')

const tap = require('tap-lite-tester')
tap.start()

genSyntaxTestCases @ tap, iterSyntaxVariations()
if 0 ::
  for let xform of Object.values @ standardTransforms ::
    genSyntaxTestCases @ tap, xform @ iterSyntaxVariations()

tap.finish()


function * iterSyntaxVariations() ::
  yield * iterWhileStmts()
  yield * iterDoWhileStmts()

function * iterWhileStmts() ::
  // while (expr) body variations
  yield :: expectSyntaxError: true
    , title: 'linted while statement with expression'
    , source: @[] 'while (expr) singleStatement'

  yield :: expectValid: true
    , title: 'vanilla while statement'
    , source: @[] 'while (expr) { blockStatement }'
    , tokens: @[] 'while', '(', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'offside while statement'
    , source: @[] 'while (expr) :: blockStatement'
    , tokens: @[] 'while', '(', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'offside while statement, multiline'
    , source: @[] 'while (expr) ::'
                , '  blockStatement'
    , tokens: @[] 'while', '(', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword offside while statement'
    , source: @[] 'while expr :: blockStatement'
    , tokens: @[] 'while', '(', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword offside while statement, multiline'
    , source: @[] 'while expr ::'
                , '  blockStatement'
    , tokens: @[] 'while', '(', 'name', ')', '{', 'name', '}', 'eof'


function * iterDoWhileStmts() ::
  // do {} while (expr) body variations
  yield :: expectSyntaxError: true
    , title: 'linted do / while statement with expression'
    , source: @[] 'do singleStatement while (expr)'

  yield :: expectValid: true
    , title: 'vanilla do / while statement'
    , source: @[] 'do { blockStatement } while (expr)'
    , tokens: @[] 'do', '{', 'name', '}', 'while', '(', 'name', ')', 'eof'

  yield :: expectValid: true
    , title: 'offside do / while statement'
    , source: @[] 'do :: blockStatement'
                , 'while (expr)'
    , tokens: @[] 'do', '{', 'name', '}', 'while', '(', 'name', ')', 'eof'

  yield :: expectValid: true
    , title: 'keyword offside do / while statement'
    , source: @[] 'do :: blockStatement'
                , 'while expr'
    , tokens: @[] 'do', '{', 'name', '}', 'while', '(', 'name', ')', 'eof'


