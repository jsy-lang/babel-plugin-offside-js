const fs = require('fs')
const path = require('path')
const babel = require('babel-core')

const babel_opt =
  @{} babelrc: false
    , highlightCode: false
    , sourceMaps: 'inline'
    , plugins: @[]
        @[] path.resolve(__dirname, '../dist/')
          , @{} demo_options: 1942, keyword_blocks: true

Object.assign @ exports,
  @{} babel_opt
    , transformExampleCode
    , showTransformedCode
    , showFormattedOutput

function transformExampleCode(filename, show=null) ::
  filename = path.resolve(__dirname, filename)
  if (show && 'function' !== typeof show) ::
    show = showTransformedCode

  return new Promise 
    @ (resolve, reject) => ::
      fs.readFile @ filename, 'utf-8', (err, source) => ::
        if (err) :: return reject(err)

        try ::
          const res = babel.transform(source, babel_opt)
          if (show) :: show @ source, res.code
          resolve(res.code)

        catch (err) ::
          reject(err)
      
    .catch @ err => ::()
      console.error(err), Promise.reject(err)


function showTransformedCode(source, transformed) ::
  show @ 'Original', source
  show @ 'Transformed', transformed

function showFormattedOutput(label, code) ::
  console.log()
  console.log(`#### ${label}:`)
  console.log()
  console.log('```javascript')
  console.log(code)
  console.log('```')
  console.log()
