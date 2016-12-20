
function outer(mind) ::
  console.log @
    'what', 'would', 
    'you', 'do?'


  if (mind < 'blown') ::
    return false
  else ::
    console.log @ 
      'write more code?',
      Math.max @ @[]
        1,
        2,
        3,

  fs.readFile @ `${__dirname}/example1.js`, 'utf-8', (err, data) => ::
    try ::
      console.log(data)
    catch (err) ::
      console.error(err)
