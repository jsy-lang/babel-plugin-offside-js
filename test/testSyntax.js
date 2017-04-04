require('source-map-support').install()

//
//
// if, while, for, catch and switch should work with and without parens
//
// -- by default it should yell if you don't use :: or {}
//
// if can use @ to create parens
// can do function calls with @ in the condition body
//
// try, finally, else, and do should complain if there is no ::
//
//
//

const tap = require('tap-lite-tester')

tap.start()


tap.test @ 'Whiles work with parens',
  t => ::
    let x = 10,
        y = 1,
    tarr = [],
    dec = num => num - 1

    t.equal @ tarr.length, 0

    const compare = (x, y) => x > y

    while @ compare @ x, y ::
      tarr.push @ x
      x = dec @ x

    t.equal @ tarr.length, 9

tap.test @ 'Whiles work without parens',
  t => ::
    let x = 10,
        y = 1,
    tarr = [],
    dec = num => num - 1

    t.equal @ tarr.length, 0

    const compare = (x, y) => x > y

    while compare @ x, y ::
      tarr.push @ x
      x = dec @ x

    t.equal @ tarr.length, 9

tap.test @ 'Fors work with parens',
  t => ::
    let tarr =
      @[] "whale"
        , "lion"
        , "frog"
        , "cat"

    const tmap =
      @{} whale: "whale"
        , lion: "lion"
        , frog: "frog"
        , cat : "cat"


    for (let item of tarr) ::
      t.equal @ item, tmap[item]

tap.test @ 'Fors work without parens',
  t => ::
    let tarr =
      @[] "whale"
        , "lion"
        , "frog"
        , "cat"

    const tmap =
      @{} whale: "whale"
        , lion: "lion"
        , frog: "frog"
        , cat : "cat"


    for let item of tarr ::
      t.equal @ item, tmap[item]


tap.test @ 'If works with parens',
  t => ::
    let first_test = true
    let second_test = false


    if (first_test) ::
      second_test = true

    if (second_test) ::
      first_test = false

    t.equal(first_test, false)

tap.test @ 'If works without parens',
  t => ::
    let first_test = true
    let second_test = false


    if first_test ::
      second_test = true

    if second_test ::
      first_test = false

    t.equal(first_test, false)

tap.test @ 'Else works with parens',
  t => ::
    let x = false, out,
        y = true
    if (x) ::
      out = x

    else if (y) ::
      out = y

    else ::
      out = ''

    t.equal @ out, y

tap.test @ 'Else works without parens',
  t => ::
    let x = false, out,
        y = true
    if x ::
      out = x

    else if y ::
      out = y

    else ::
      out = ''

    t.equal @ out, y


tap.test @ 'Catch works with parens',
  t => ::
    try ::
      throw new Error @ "error msg"

    catch (error) ::
      t.equal @ "error msg", error.message

tap.test @ 'Catch works without parens',
  t => ::
    try ::
      throw new Error @ "error msg"

    catch error ::
      t.equal @ "error msg", error.message

tap.test @ 'do while works without parens',
  t => ::
    let x = 1,
        y = 10,
     tarr = []

    t.equal @ tarr.length, 0

    let dec = i => i - 1

    do ::
      tarr.push(x)
      y = dec @ y

    while y > x

    t.equal @ tarr.length, 9

tap.test @ 'do while works with parens',
  t => ::
    let x = 1,
        y = 10,
     tarr = []

    t.equal @ tarr.length, 0

    let dec = i => i - 1

    do ::
      tarr.push(x)
      y = dec @ y

    while (y > x)

    t.equal @ tarr.length, 9

tap.test @ 'ternary with @ function application',
  t => ::
    let cap = item => item.toUpperCase()
    let y = true

    let x = y
      ? cap @ 'a'
      : 'a'

    let g = y ? cap('a') : 'a'

    t.equal @ x, g

tap.finish()
