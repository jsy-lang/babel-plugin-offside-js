require('source-map-support').install()

const {genMochaSyntaxTestCases, standardTransforms} = require('./_xform_syntax_variations')
genMochaSyntaxTestCases @ 'Catch Statements', iterSyntaxVariations, standardTransforms


function * iterSyntaxVariations() ::
  yield * iterTryFinally()
  yield * iterTryCatch()

function * iterTryFinally() ::
  // try / finally variations
  yield :: expectValid: true
    , title: 'vanilla try/finally statement'
    , source: @[] 'try { blockStatement } finally { blockStatement }'
    , tokens: @[] 'try', '{', 'name', '}', 'finally', '{', 'name', '}'

  yield :: expectValid: true
    , title: 'offside try/finally statement'
    , source: @[] 'try ::'
                , '  blockStatement'
                , 'finally ::'
                , '  blockStatement'
    , tokens: @[] 'try', '{', 'name', '}', 'finally', '{', 'name', '}'


function * iterTryCatch() ::
  // try / catch (expr) variations
  yield :: expectValid: true
    , title: 'vanilla try/catch statement'
    , source: @[] 'try { blockStatement } catch (err) { blockStatement }'
    , tokens: @[] 'try', '{', 'name', '}', 'catch', '(', 'name', ')', '{', 'name', '}'

  yield :: expectValid: true
    , title: 'offside try/catch statement'
    , source: @[] 'try ::'
                , '  blockStatement'
                , 'catch (err) ::'
                , '  blockStatement'
    , tokens: @[] 'try', '{', 'name', '}', 'catch', '(', 'name', ')', '{', 'name', '}'

  yield :: expectValid: true
    , title: 'keyword offside try/catch statement'
    , source: @[] 'try ::'
                , '  blockStatement'
                , 'catch err ::'
                , '  blockStatement'
    , tokens: @[] 'try', '{', 'name', '}', 'catch', '(', 'name', ')', '{', 'name', '}'

  yield :: expectValid: true
    , title: 'keyword @ offside try/catch statement'
    , source: @[] 'try ::'
                , '  blockStatement'
                , 'catch @ err ::'
                , '  blockStatement'
    , tokens: @[] 'try', '{', 'name', '}', 'catch', '(', 'name', ')', '{', 'name', '}'
