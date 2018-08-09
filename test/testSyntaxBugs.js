require('source-map-support').install()

const {genMochaSyntaxTestCases, standardTransforms} = require('./_xform_syntax_variations')
genMochaSyntaxTestCases @ 'Previous Syntax Bugs', iterSyntaxVariations, standardTransforms




function * iterSyntaxVariations() ::
  yield * iterBugWithBlankFirstLine()

function * iterBugWithBlankFirstLine() ::
  yield @{} expectValid: true
    title: 'Filled first line of block '
    source: @[]
      'const a = @{}'
      '  v1: 1'
      '  v2: \'two\''
      ''
      '  v3: null'
    tokens: @[] 'const', 'name', '=', '{', 'name', ':', 'num', ',', 'name', ':', 'string', ',', 'name', ':', 'null', '}'

  yield @{} expectValid: true
    title: 'Blank first line of block '
    source: @[]
      'const a = @{}'
      ''
      '  v1: 1'
      '  v2: \'two\''
      ''
      '  v3: null'
    tokens: @[] 'const', 'name', '=', '{', 'name', ':', 'num', ',', 'name', ':', 'string', ',', 'name', ':', 'null', '}'

