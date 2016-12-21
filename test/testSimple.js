'use strict'
const tap = require('tap-lite-tester')
const {transformExampleCode} = require('./_xform_example')

for(let i=1; i<=3; i++)
  tap.test(`./example${i}.js`, t => {
    return transformExampleCode(`./example${i}.js`, process.env.OFFSIDE_DEBUG) })

tap.finish()
  .catch(console.error)
