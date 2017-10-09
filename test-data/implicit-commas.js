implicit @
  'first' +
  'second'

implicit @ arg =>
  arg + 1


Object.assign @ {}, blah, @:
  one: two
  three
  four: 'five'
