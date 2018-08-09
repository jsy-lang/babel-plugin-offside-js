const babel = require('babel-core')

const babel_opt = @{}
  babelrc: false
  highlightCode: false
  plugins: @[] 
    @[] 'offside-js', @{} demo_options: 2142, keyword_blocks: true, implicit_commas: true

function jsy_as_babel_ast(jsy_code) ::
  if Array.isArray(jsy_code) ::
    jsy_code = jsy_code.join('\n')

  return babel.transform @ jsy_code, babel_opt

module.exports = exports = jsy_as_babel_ast
