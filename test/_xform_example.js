'use strict'
const fs = require('fs')
const path = require('path')
const babel = require('babel-core')

const babel_opt =
  { plugins: [[path.resolve(__dirname, '../dist/'), {demo_options: 1942, keyword_blocks: true}]]
  , sourceMaps: 'inline' }

Object.assign(exports,
    { babel_opt
    , transformExampleCode
    , showFormattedOutput })

function transformExampleCode(filename, show=null) {
  filename = path.resolve(__dirname, filename)
  if (show && 'function' !== typeof show)
    show = showFormattedOutput

  return new Promise((resolve, reject) => (
      fs.readFile(filename, 'utf-8', (err, original) => {
        if (err) return reject(err)

        try {
          let res = babel.transform(original, babel_opt)
          if (show) show('Original', original)
          if (show) show('Transformed', res.code)
          resolve(res.code)

        } catch (err) {
          reject(err)
        }
      })))
      
    .catch(err => (console.error(err), Promise.reject(err))) }


function showFormattedOutput(label, code) {
  console.log()
  console.log(`#### ${label}:`)
  console.log()
  console.log('```javascript')
  console.log(code)
  console.log('```')
  console.log()
}
