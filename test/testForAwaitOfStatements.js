require('source-map-support').install()

const {genSyntaxTestCases, asyncFunctionTransforms} = require('./_xform_syntax_variations')

describe @ 'For Await Of Statements', @=> ::
  const {inAsyncFunction} = asyncFunctionTransforms
  const transforms = 1 ? asyncFunctionTransforms : {inAsyncFunction}

  for const [name, xform] of Object.entries @ transforms ::
    describe @ name, @=> genSyntaxTestCases @ it, xform @ iterSyntaxVariations()


function * iterSyntaxVariations() ::
  yield * iterForAwaitOfStatements()
  yield * iterKeywordOffsideForAwaitOfStatements()
  yield * iterKeywordOffsideForAwaitOfWithCallStatements()
  yield * iterKeywordAtOffsideForAwaitOfStatements()


function * iterForAwaitOfStatements() ::
  // for await (each of iterable) body variations
  yield @{} expectValid: true
      title: 'vanilla for await of statement'
      source: @[] 'for await (each of iterable) { blockStatement }'
      tokens: @[] 'for', 'name', '(', 'name', 'name', 'name', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'vanilla for await of let statement'
      source: @[] 'for await (let each of iterable) { blockStatement }'
      tokens: @[] 'for', 'name', '(', 'let', 'name', 'name', 'name', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'vanilla for await of const statement'
      source: @[] 'for await (const each of iterable) { blockStatement }'
      tokens: @[] 'for', 'name', '(', 'const', 'name', 'name', 'name', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'offside for await of statement'
      source: @[] 'for await (each of iterable) :: blockStatement'
      tokens: @[] 'for', 'name', '(', 'name', 'name', 'name', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'offside for await of statement, multiline'
      source: @[] 'for await (each of iterable) ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', 'name', 'name', 'name', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'offside for await of let statement, multiline'
      source: @[] 'for await (let each of iterable) ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', 'let', 'name', 'name', 'name', ')', '{', 'name', '}'



function * iterKeywordOffsideForAwaitOfStatements() ::
  yield @{} expectValid: true
      title: 'keyword offside for await of statement'
      source: @[] 'for await each of iterable :: blockStatement'
      tokens: @[] 'for', 'name', '(', 'name', 'name', 'name', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'keyword offside let for await of statement'
      source: @[] 'for await let each of iterable :: blockStatement'
      tokens: @[] 'for', 'name', '(', 'let', 'name', 'name', 'name', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'keyword offside for await of statement, multiline'
      source: @[] 'for await each of iterable ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', 'name', 'name', 'name', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'ordered unpack keyword offside for await of statement, multiline'
      source: @[] 'for await [a,b] of iterable ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', '[', 'name', ',', 'name', ']', 'name', 'name', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'named unpack keyword offside for await of statement, multiline'
      source: @[] 'for await {a,b} of iterable ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', '{', 'name', ',', 'name', '}', 'name', 'name', ')', '{', 'name', '}'


function * iterKeywordOffsideForAwaitOfWithCallStatements() ::
  yield @{} expectValid: true
      title: 'keyword offside for await of statement with call'
      source: @[] 'for await each of fn_call @ x, y ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', 'name', 'name', 'name', '(', 'name', ',', 'name', ')', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'keyword offside for await of let statement with call'
      source: @[] 'for await let each of fn_call @ x, y ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', 'let', 'name', 'name', 'name', '(', 'name', ',', 'name', ')', ')', '{', 'name', '}'


  yield @{} expectValid: true
      title: 'ordered unpack keyword offside for await of statement with call'
      source: @[] 'for await [a,b] of fn_call @ x, y ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', '[', 'name', ',', 'name', ']', 'name', 'name', '(', 'name', ',', 'name', ')', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'named unpack keyword offside for await of statement with call'
      source: @[] 'for await {a,b} of fn_call @ x, y ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', '{', 'name', ',', 'name', '}', 'name', 'name', '(', 'name', ',', 'name', ')', ')', '{', 'name', '}'


function * iterKeywordAtOffsideForAwaitOfStatements() ::
  yield @{} expectValid: true
      title: 'keyword @ offside for await of let statement, multiline'
      source: @[] 'for await @ let each of iterable ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', 'let', 'name', 'name', 'name', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'keyword @ offside for await of statement, multiline'
      source: @[] 'for await @ each of iterable ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', 'name', 'name', 'name', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'ordered unpack keyword @ offside for await of statement, multiline'
      source: @[] 'for await @ [a,b] of iterable ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', '[', 'name', ',', 'name', ']', 'name', 'name', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'named unpack keyword @ offside for await of statement, multiline'
      source: @[] 'for await @ {a,b} of iterable ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', '{', 'name', ',', 'name', '}', 'name', 'name', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'ordered unpack keyword @ offside for await of statement with call'
      source: @[] 'for await @ [a,b] of fn_call @ x, y ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', '[', 'name', ',', 'name', ']', 'name', 'name', '(', 'name', ',', 'name', ')', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'named unpack keyword @ offside for await of statement with call'
      source: @[] 'for await @ {a,b} of fn_call @ x, y ::'
                  '  blockStatement'
      tokens: @[] 'for', 'name', '(', '{', 'name', ',', 'name', '}', 'name', 'name', '(', 'name', ',', 'name', ')', ')', '{', 'name', '}'

