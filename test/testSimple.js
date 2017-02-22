require('source-map-support').install()
const tap = require('tap-lite-tester')
const {transformExampleCode} = require('./_xform_example')

for(let i=1; i<=5; i++) {
  tap.test(`./example${i}.js`, t => {
    return transformExampleCode(`./example${i}.js`, process.env.OFFSIDE_DEBUG)
  })
}

tap.finish()
  .catch(console.error)
