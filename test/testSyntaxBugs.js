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

