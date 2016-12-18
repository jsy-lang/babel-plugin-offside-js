# babel-plugin-offside-js
Babel offside (indention) Javascript syntax extension.



#### Original:

```javascript
function outer(mind) ::
  console.log @
    'what', 'would', 
    'you', 'do?'


  if (mind < 'blown') ::
    return false
  else ::
    console.log @ 
      'write more code?',
      Math.max @
        1,
        2,
        3,

```



#### Transformed:

```javascript
function outer(mind) {
  console.log('what', 'would', 'you', 'do?');

  if (mind < 'blown') {
    return false;
  } else {
    console.log('write more code?', Math.max(1, 2, 3));
  }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInVua25vd24iXSwibmFtZXMiOlsib3V0ZXIiLCJtaW5kIiwiY29uc29sZSIsImxvZyIsIk1hdGgiLCJtYXgiXSwibWFwcGluZ3MiOiI7QUFDQSxTQUFTQSxLQUFULENBQWVDLElBQWYsRUFBcUI7QUFDbkJDLFVBQVFDLEdBQVIsQ0FDRSxNQURGLEVBQ1UsT0FEVixFQUVFLEtBRkYsRUFFUyxLQUZUOztBQUtBLE1BQUlGLE9BQU8sT0FBWCxFQUFvQjtBQUNsQixXQUFPLEtBQVA7QUFBWSxHQURkLE1BRUs7QUFDSEMsWUFBUUMsR0FBUixDQUNFLGtCQURGLEVBRUVDLEtBQUtDLEdBQUwsQ0FDRSxDQURGLEVBRUUsQ0FGRixFQUdFLENBSEYsQ0FGRjtBQUtNO0FBQUEiLCJmaWxlIjoidW5rbm93biIsInNvdXJjZXNDb250ZW50IjpbIlxuZnVuY3Rpb24gb3V0ZXIobWluZCkgOjpcbiAgY29uc29sZS5sb2cgQFxuICAgICd3aGF0JywgJ3dvdWxkJywgXG4gICAgJ3lvdScsICdkbz8nXG5cblxuICBpZiAobWluZCA8ICdibG93bicpIDo6XG4gICAgcmV0dXJuIGZhbHNlXG4gIGVsc2UgOjpcbiAgICBjb25zb2xlLmxvZyBAIFxuICAgICAgJ3dyaXRlIG1vcmUgY29kZT8nLFxuICAgICAgTWF0aC5tYXggQFxuICAgICAgICAxLFxuICAgICAgICAyLFxuICAgICAgICAzLFxuXG4iXX0=
```
