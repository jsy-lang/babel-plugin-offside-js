require('source-map-support').install()
const assert = require('assert')

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

describe @ 'Test Offside Syntax', @=> ::

  it @ 'Whiles work with parens', @=> ::
      let x = 10,
          y = 1,
      tarr = [],
      dec = num => num - 1

      assert.equal @ tarr.length, 0

      const compare = (x, y) => x > y

      while @ compare @ x, y ::
        tarr.push @ x
        x = dec @ x

      assert.equal @ tarr.length, 9

  it @ 'Whiles work without parens', @=> ::
      let x = 10,
          y = 1,
      tarr = [],
      dec = num => num - 1

      assert.equal @ tarr.length, 0

      const compare = (x, y) => x > y

      while compare @ x, y ::
        tarr.push @ x
        x = dec @ x

      assert.equal @ tarr.length, 9

  it @ 'Fors work with parens', @=> ::
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
        assert.equal @ item, tmap[item]

  it @ 'Fors work without parens', @=> ::
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
        assert.equal @ item, tmap[item]


  it @ 'Using @# and @: operators', @=> ::
      let tarr = @#
            "whale"
          , "lion"
          , "frog"
          , "cat"

      const tmap = @:
            whale: "whale"
          , lion: "lion"
          , frog: "frog"
          , cat : "cat"


      for let item of tarr ::
        assert.equal @ item, tmap[item]


  it @ 'If works with parens', @=> ::
      let first_test = true
      let second_test = false


      if (first_test) ::
        second_test = true

      if (second_test) ::
        first_test = false

      assert.equal(first_test, false)

  it @ 'If works without parens', @=> ::
      let first_test = true
      let second_test = false


      if first_test ::
        second_test = true

      if second_test ::
        first_test = false

      assert.equal(first_test, false)

  it @ 'Else works with parens', @=> ::
      let x = false, out,
          y = true
      if (x) ::
        out = x

      else if (y) ::
        out = y

      else ::
        out = ''

      assert.equal @ out, y

  it @ 'Else works without parens', @=> ::
      let x = false, out,
          y = true
      if x ::
        out = x

      else if y ::
        out = y

      else ::
        out = ''

      assert.equal @ out, y


  it @ 'Catch works with parens', @=> ::
      try ::
        throw new Error @ "error msg"

      catch (error) ::
        assert.equal @ "error msg", error.message

  it @ 'Catch works without parens', @=> ::
      try ::
        throw new Error @ "error msg"

      catch error ::
        assert.equal @ "error msg", error.message

  it @ 'do while works without parens', @=> ::
      let x = 1,
          y = 10,
       tarr = []

      assert.equal @ tarr.length, 0

      let dec = i => i - 1

      do ::
        tarr.push(x)
        y = dec @ y

      while y > x

      assert.equal @ tarr.length, 9

  it @ 'do while works with parens', @=> ::
      let x = 1,
          y = 10,
       tarr = []

      assert.equal @ tarr.length, 0

      let dec = i => i - 1

      do ::
        tarr.push(x)
        y = dec @ y

      while (y > x)

      assert.equal @ tarr.length, 9

  it @ 'ternary with @ function application', @=> ::
      let cap = item => item.toUpperCase()
      let y = true

      let x = y
        ? cap @ 'a'
        : 'a'

      let g = y ? cap('a') : 'a'

      assert.equal @ x, g


  it @ 'named-parameters with @: function application', @=> ::
    const example_one = (opt) => opt
    assert.deepEqual @ {first: true, second: [1,2,3]},
      example_one @: first: true, second: @[] 1, 2, 3

    const example_two = (a,b,c) => @: a,b,c
    assert.deepEqual @ {a: 19, b: 42, c: 1942}, example_two @ 19, 42, 1942

  it @ 'chained function application with trailing @:', @=> ::
    const identity = x => x
    assert.deepEqual @ {answer: 42},
      identity @ identity @ identity @:
        answer: 42

  it @ 'expressjs-like composite route binding', @=> ::
    const mock = :: get() ::
    const wrapper = function(fn) ::

    mock.get @ '/someRoute', wrapper @ async (req, res) => ::
      res.json @ {worked: true}

