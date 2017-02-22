function outer() ::

  if (expr) { blockStatement }
  else if (expr) { blockStatement }
  else { blockStatement }

  if (expr) :: blockStatement
  else if (expr) :: blockStatement
  else :: blockStatement

  if expr :: blockStatement
  else if expr :: blockStatement
  else :: blockStatement


  for (let i=0; i<n; i++) { blockStatement }
  for (let i=0; i<n; i++) :: blockStatement
  for let i=0; i<n; i++ :: blockStatement


  for (let ea of iterable) { blockStatement }
  for (let ea of iterable) :: blockStatement
  for let ea of iterable :: blockStatement


  while (expr) { blockStatement }

  while (expr) :: blockStatement

  while expr :: blockStatement


  do { blockStatement }
  while (expr)

  do :: blockStatement
  while (expr)

  do :: blockStatement
  while expr


  switch (expr) {default: blockStatement}

  switch expr :: default: blockStatement



  try { tryblock }
  catch (expr) { blockStatement }

  try :: tryblock
  catch (expr) { blockStatement }

  try :: tryblock
  catch (expr) :: blockStatement

  try :: tryblock
  catch expr :: blockStatement


  promise.catch(err => err)
  promise.catch @ err => err
  promise.catch @ err => :: err

  const ns_1 = {catch: err => err}
  const ns_2 = @{} catch: err => err
  const ns_3 = @{} catch(err) ::

