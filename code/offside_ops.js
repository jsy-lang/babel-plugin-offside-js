
export function offsideOperatorsForBabylon(tokTypes) ::
  const tt = tokTypes

  const implicitCommaContext = @:
    objectLiteral: new Set @#
      tt.star // allow generator defintions with implicit commas

  const at_offside = @{}
    '::':   @{} tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: false, codeBlock: true, implicitCommas: false,
    '::@':  @{} tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, extraChars: 1, implicitCommas: false,
    '::()': @{} tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, extraChars: 2, implicitCommas: false,
    '::{}': @{} tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: false, extraChars: 2, implicitCommas: false,
    '::[]': @{} tokenPre: tt.bracketL, tokenPost: tt.bracketR, nestInner: false, extraChars: 2, implicitCommas: false,

    '@':    @{} tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: true, keywordBlock: true, implicitCommas: true,
    '@:':   @{} tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: true, extraChars: 1, nestOp: '\0{,}', implicitCommas: implicitCommaContext.objectLiteral,
    '@#':   @{} tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: true, extraChars: 1, nestOp: '\0[,]', implicitCommas: true,
    '@()':  @{} tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: true, extraChars: 2, implicitCommas: true,
    '@{}':  @{} tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: true, extraChars: 2, implicitCommas: implicitCommaContext.objectLiteral,
    '@[]':  @{} tokenPre: tt.bracketL, tokenPost: tt.bracketR, nestInner: true, extraChars: 2, implicitCommas: true,

    // note:  no '@()' -- standardize to use single-char '@ ' instead
    keyword_args: @{} tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, inKeywordArg: true, implicitCommas: false,

    // synthetic nestOp delegate operations
    '\0{,}': @{} tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: false, implicitCommas: implicitCommaContext.objectLiteral,
    '\0[,]': @{} tokenPre: tt.bracketL, tokenPost: tt.bracketR, nestInner: false, implicitCommas: true,


  Object.entries(at_offside).forEach @ ([name, opRec]) =>
    Object.assign @ opRec, @: name
  return at_offside

const rx_offside = /^([ \t]*)(.*)$/mg
export function parseOffsideIndexMap(input) ::
  let lines = [null], posLastContent=0, last=['', 0]
  let idx_lastContent=0

  input.replace @ rx_offside, (match, indent, content, pos) => ::
    if ! content ::
      posLastContent = last
      indent = false
    else ::
      // valid content; set last to current indent
      posLastContent = pos + match.length
      idx_lastContent = lines.length
      last = posLastContent
    lines.push @: line: lines.length, posFirstContent:pos, posLastContent, indent, content
    return ''

  lines.splice(1+idx_lastContent) // trim trailing whitespace
  return lines

