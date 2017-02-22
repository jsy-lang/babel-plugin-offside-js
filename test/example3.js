
if (expr) { blockStatement }
else if (expr) { blockStatement }
else { blockStatement }

if (expr) :: blockStatement
else if (expr) :: blockStatement
else :: blockStatement

if expr :: blockStatement
else if expr :: blockStatement
else :: blockStatement



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

