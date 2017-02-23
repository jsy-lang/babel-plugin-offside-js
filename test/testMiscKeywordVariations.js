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
  yield * iterPromiseCatch()
  yield * iterHashCatchFn()


function * iterPromiseCatch() ::
  // catch keyword after promise-- promise.catch @ err => err
  yield :: expectValid: true
    , title: 'promise.catch vanilla'
    , source: @[] 'promise.catch(err => err)'
    , tokens: @[] "name", ".", "catch", "(", "name", "=>", "name", ")", "eof"

  yield :: expectValid: true
    , title: 'promise.catch offside arrow expression'
    , source: @[] 'promise.catch @ err => err'
    , tokens: @[] "name", ".", "catch", "(", "name", "=>", "name", ")", "eof"

  yield :: expectValid: true
    , title: 'promise.catch offside arrow block'
    , source: @[] 'promise.catch @ err => :: err'
    , tokens: @[] "name", ".", "catch", "(", "name", "=>", "{", "name", "}", ")", "eof"


function * iterHashCatchFn() ::
  // catch keyword within hash -- {catch: err => err}
  yield :: expectValid: true
    , title: 'hash (vanilla) with catch entry arrow expression'
    , source: @[] 'const ns = {catch: err => err}'
    , tokens: @[] "const", "name", "=", "{", "catch", ":", "name", "=>", "name", "}", "eof"

  yield :: expectValid: true
    , title: 'hash (offside) with catch entry arrow expression'
    , source: @[] 'const ns = @{} catch: err => err'
    , tokens: @[] "const", "name", "=", "{", "catch", ":", "name", "=>", "name", "}", "eof"

  yield :: expectValid: true
    , title: 'hash (offside) with catch entry arrow block'
    , source: @[] 'const ns = @{} catch: err => :: err'
    , tokens: @[] "const", "name", "=", "{", "catch", ":", "name", "=>", "{", "name", "}", "}", "eof"

  yield :: expectValid: true
    , title: 'hash (offside) with catch function'
    , source: @[] 'const ns = @{} catch(err) :: '
    , tokens: @[] "const", "name", "=", "{", "catch", "(", "name", ")", "{", "}", "}", "eof"
