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

  fs.readFile @ `${__dirname}/example1.js`, 'utf-8', (err, data) => ::
    try ::
      console.log(data)
    catch (err) ::
      console.error(err)
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

  fs.readFile(`${ __dirname }/example1.js`, 'utf-8', (err, data) => {
    try {
      console.log(data);
    } catch (err) {
      console.error(err);
    }
  });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInVua25vd24iXSwibmFtZXMiOlsib3V0ZXIiLCJtaW5kIiwiY29uc29sZSIsImxvZyIsIk1hdGgiLCJtYXgiLCJmcyIsInJlYWRGaWxlIiwiX19kaXJuYW1lIiwiZXJyIiwiZGF0YSIsImVycm9yIl0sIm1hcHBpbmdzIjoiO0FBQ0EsU0FBU0EsS0FBVCxDQUFlQyxJQUFmLEVBQXFCO0FBQ25CQyxVQUFRQyxHQUFSLENBQ0UsTUFERixFQUNVLE9BRFYsRUFFRSxLQUZGLEVBRVMsS0FGVDs7QUFLQSxNQUFJRixPQUFPLE9BQVgsRUFBb0I7QUFDbEIsV0FBTyxLQUFQO0FBQVksR0FEZCxNQUVLO0FBQ0hDLFlBQVFDLEdBQVIsQ0FDRSxrQkFERixFQUVFQyxLQUFLQyxHQUFMLENBQ0UsQ0FERixFQUVFLENBRkYsRUFHRSxDQUhGLENBRkY7QUFLTTs7QUFFUkMsS0FBR0MsUUFBSCxDQUFlLElBQUVDLFNBQVUsZUFBM0IsRUFBMEMsT0FBMUMsRUFBbUQsQ0FBQ0MsR0FBRCxFQUFNQyxJQUFOLEtBQWU7QUFDaEUsUUFBSTtBQUNGUixjQUFRQyxHQUFSLENBQVlPLElBQVo7QUFBaUIsS0FEbkIsQ0FFQSxPQUFPRCxHQUFQLEVBQVk7QUFDVlAsY0FBUVMsS0FBUixDQUFjRixHQUFkO0FBQWtCO0FBQUEsR0FKdEI7QUFJc0IiLCJmaWxlIjoidW5rbm93biIsInNvdXJjZXNDb250ZW50IjpbIlxuZnVuY3Rpb24gb3V0ZXIobWluZCkgOjpcbiAgY29uc29sZS5sb2cgQFxuICAgICd3aGF0JywgJ3dvdWxkJywgXG4gICAgJ3lvdScsICdkbz8nXG5cblxuICBpZiAobWluZCA8ICdibG93bicpIDo6XG4gICAgcmV0dXJuIGZhbHNlXG4gIGVsc2UgOjpcbiAgICBjb25zb2xlLmxvZyBAIFxuICAgICAgJ3dyaXRlIG1vcmUgY29kZT8nLFxuICAgICAgTWF0aC5tYXggQFxuICAgICAgICAxLFxuICAgICAgICAyLFxuICAgICAgICAzLFxuXG4gIGZzLnJlYWRGaWxlIEAgYCR7X19kaXJuYW1lfS9leGFtcGxlMS5qc2AsICd1dGYtOCcsIChlcnIsIGRhdGEpID0+IDo6XG4gICAgdHJ5IDo6XG4gICAgICBjb25zb2xlLmxvZyhkYXRhKVxuICAgIGNhdGNoIChlcnIpIDo6XG4gICAgICBjb25zb2xlLmVycm9yKGVycilcblxuIl19
```
