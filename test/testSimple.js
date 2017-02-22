require('source-map-support').install()

const tap = require('tap-lite-tester')
const {transformExampleCode} = require('./_xform_example')

for(let i=1; i<=5; i++) ::
  let filename = `example${i}.js`
  tap.test @ filename, t => ::
    return transformExampleCode @
      `../test-data/${filename}`
      , process.env.OFFSIDE_DEBUG

tap.finish()
  .catch(console.error)
