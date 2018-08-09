require('source-map-support').install()

const {genMochaSyntaxTestCases, standardTransforms} = require('./_xform_syntax_variations')
describe @ 'For Of Step Statements',
  genMochaSyntaxTestCases @ iterSyntaxVariations, standardTransforms




function * iterSyntaxVariations() ::
  yield @{} expectValid: true
      title: 'vanilla for/step statement'
      source: @[] 'for (i=0; i<n; i++) { blockStatement }'
      tokens: @[] 'for', '(', 'name', '=', 'num', ';', 'name', '</>', 'name', ';', 'name', '++/--', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'vanilla for/step let statement'
      source: @[] 'for (let i=0; i<n; i++) { blockStatement }'
      tokens: @[] 'for', '(', 'let', 'name', '=', 'num', ';', 'name', '</>', 'name', ';', 'name', '++/--', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'offside for/step statement'
      source: @[] 'for (i=0; i<n; i++) :: blockStatement'
      tokens: @[] 'for', '(', 'name', '=', 'num', ';', 'name', '</>', 'name', ';', 'name', '++/--', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'offside for/step let statement'
      source: @[] 'for (let i=0; i<n; i++) :: blockStatement'
      tokens: @[] 'for', '(', 'let', 'name', '=', 'num', ';', 'name', '</>', 'name', ';', 'name', '++/--', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'offside for/step let statement, multiline'
      source: @[] 'for (let i=0; i<n; i++) ::'
                  '  blockStatement'
      tokens: @[] 'for', '(', 'let', 'name', '=', 'num', ';', 'name', '</>', 'name', ';', 'name', '++/--', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'keyword offside for/step statement'
      source: @[] 'for i=0; i<n; i++ :: blockStatement'
      tokens: @[] 'for', '(', 'name', '=', 'num', ';', 'name', '</>', 'name', ';', 'name', '++/--', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'keyword offside for/step statement, multiline'
      source: @[] 'for i=0; i<n; i++ ::'
                  '  blockStatement'
      tokens: @[] 'for', '(', 'name', '=', 'num', ';', 'name', '</>', 'name', ';', 'name', '++/--', ')', '{', 'name', '}'

  yield @{} expectValid: true
      title: 'keyword offside for/step let statement'
      source: @[] 'for let i=0; i<n; i++ :: blockStatement'
      tokens: @[] 'for', '(', 'let', 'name', '=', 'num', ';', 'name', '</>', 'name', ';', 'name', '++/--', ')', '{', 'name', '}'

