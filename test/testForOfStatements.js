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
  yield * iterForOfSyntaxErrors()
  yield * iterForOfStatements()
  yield * iterKeywordOffsideForOfStatements()
  yield * iterKeywordOffsideForOfWithCallStatements()
  yield * iterKeywordAtOffsideForOfStatements()


function * iterForOfSyntaxErrors() ::
  yield :: expectSyntaxError: true
    , title: 'linted for/of statement with expression'
    , source: @[] 'for (each of iterable) singleStatement'

  yield :: expectSyntaxError: true
    , title: 'linted for/of let statement with expression'
    , source: @[] 'for (let each of iterable) singleStatement'

  yield :: expectSyntaxError: true
    , title: 'linted for/of const statement with expression'
    , source: @[] 'for (const each of iterable) singleStatement'


function * iterForOfStatements() ::
  // for (each of iterable) body variations
  yield :: expectValid: true
    , title: 'vanilla for/of statement'
    , source: @[] 'for (each of iterable) { blockStatement }'
    , tokens: @[] 'for', '(', 'name', 'name', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'vanilla for/of let statement'
    , source: @[] 'for (let each of iterable) { blockStatement }'
    , tokens: @[] 'for', '(', 'let', 'name', 'name', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'vanilla for/of const statement'
    , source: @[] 'for (const each of iterable) { blockStatement }'
    , tokens: @[] 'for', '(', 'const', 'name', 'name', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'offside for/of statement'
    , source: @[] 'for (each of iterable) :: blockStatement'
    , tokens: @[] 'for', '(', 'name', 'name', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'offside for/of statement, multiline'
    , source: @[] 'for (each of iterable) ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', 'name', 'name', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'offside for/of let statement, multiline'
    , source: @[] 'for (let each of iterable) ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', 'let', 'name', 'name', 'name', ')', '{', 'name', '}', 'eof'



function * iterKeywordOffsideForOfStatements() ::
  yield :: expectValid: true
    , title: 'keyword offside for/of statement'
    , source: @[] 'for each of iterable :: blockStatement'
    , tokens: @[] 'for', '(', 'name', 'name', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword offside let for/of statement'
    , source: @[] 'for let each of iterable :: blockStatement'
    , tokens: @[] 'for', '(', 'let', 'name', 'name', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword offside for/of statement, multiline'
    , source: @[] 'for each of iterable ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', 'name', 'name', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'ordered unpack keyword offside for/of statement, multiline'
    , source: @[] 'for [a,b] of iterable ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', '[', 'name', ',', 'name', ']', 'name', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'named unpack keyword offside for/of statement, multiline'
    , source: @[] 'for {a,b} of iterable ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', '{', 'name', ',', 'name', '}', 'name', 'name', ')', '{', 'name', '}', 'eof'


function * iterKeywordOffsideForOfWithCallStatements() ::
  yield :: expectValid: true
    , title: 'keyword offside for/of statement with call'
    , source: @[] 'for each of fn_call @ x, y ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', 'name', 'name', 'name', '(', 'name', ',', 'name', ')', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword offside for/of let statement with call'
    , source: @[] 'for let each of fn_call @ x, y ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', 'let', 'name', 'name', 'name', '(', 'name', ',', 'name', ')', ')', '{', 'name', '}', 'eof'


  yield :: expectValid: true
    , title: 'ordered unpack keyword offside for/of statement with call'
    , source: @[] 'for [a,b] of fn_call @ x, y ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', '[', 'name', ',', 'name', ']', 'name', 'name', '(', 'name', ',', 'name', ')', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'named unpack keyword offside for/of statement with call'
    , source: @[] 'for {a,b} of fn_call @ x, y ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', '{', 'name', ',', 'name', '}', 'name', 'name', '(', 'name', ',', 'name', ')', ')', '{', 'name', '}', 'eof'


function * iterKeywordAtOffsideForOfStatements() ::
  yield :: expectValid: true
    , title: 'keyword @ offside for/of let statement, multiline'
    , source: @[] 'for @ let each of iterable ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', 'let', 'name', 'name', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword @ offside for/of statement, multiline'
    , source: @[] 'for @ each of iterable ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', 'name', 'name', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'ordered unpack keyword @ offside for/of statement, multiline'
    , source: @[] 'for @ [a,b] of iterable ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', '[', 'name', ',', 'name', ']', 'name', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'named unpack keyword @ offside for/of statement, multiline'
    , source: @[] 'for @ {a,b} of iterable ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', '{', 'name', ',', 'name', '}', 'name', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'ordered unpack keyword @ offside for/of statement with call'
    , source: @[] 'for @ [a,b] of fn_call @ x, y ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', '[', 'name', ',', 'name', ']', 'name', 'name', '(', 'name', ',', 'name', ')', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'named unpack keyword @ offside for/of statement with call'
    , source: @[] 'for @ {a,b} of fn_call @ x, y ::'
                , '  blockStatement'
    , tokens: @[] 'for', '(', '{', 'name', ',', 'name', '}', 'name', 'name', '(', 'name', ',', 'name', ')', ')', '{', 'name', '}', 'eof'

