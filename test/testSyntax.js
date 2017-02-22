'use strict'

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

import tap from 'tap-lite-tester'

tap.start()


tap.todo @ 'Whiles work with parens'
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

tap.todo @ 'Fors work with parens'
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


tap.todo @ 'if works with parens'
tap.test @ 'If works without parens', 
  function (t) ::
    let first_test = true
    let second_test = false


    if first_test ::
      second_test = true
    
    if second_test ::
      first_test = false
    
    t.equal(first_test, false)

tap.todo @ 'Else works with parens'
tap.todo @ 'Else works without parens'


tap.todo @ 'Catch works with parens'
tap.todo @ 'Catch works without parens'

tap.todo @ 'Try works with parens'
tap.todo @ 'Try works without parens'

tap.todo @ 'Catch works with parens'
tap.todo @ 'Catch works without parens'




tap.finish()
