implicit @
  'first' +
  'second'

implicit @ arg =>
  arg + 1


Object.assign @ {}, blah, @:
  one: two
  three
  get six() :: return 2+4
  four: 'five'
