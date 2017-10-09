const babel_plugin_id = `babel-plugin-offside--${Date.now()}`
const default_offsidePluginOpts = @{}
    check_blocks: /\/node_modules\/|\\node_modules\\/
  , implicit_commas: true


export default function babel_plugin_offside_js(babel) ::
  return @:
      name: babel_plugin_id

    , pre(state) ::
        this.opts = Object.assign @ {}, default_offsidePluginOpts, this.opts

        let check_blocks = this.opts.check_blocks
        if check_blocks instanceof Function ::
          check_blocks = check_blocks @ state.opts.filename
        else if check_blocks instanceof RegExp ::
          check_blocks = ! check_blocks.test @ state.opts.filename
        else if 'string' === typeof check_blocks ::
          check_blocks = ! new RegExp(check_blocks).test @ state.opts.filename

        this.opts.check_blocks = check_blocks = !! check_blocks

    //, post(state) :: console.dir @ state.ast.program, @{} colors: true, depth: null

    , manipulateOptions(opts, parserOpts) ::
        parserOpts.plugins.push('asyncGenerators', 'classProperties', 'decorators', 'functionBind')
        const offsidePluginOpts = opts.plugins
          .filter @ plugin => plugin[0] && babel_plugin_id === plugin[0].key && plugin[1]
          .map @ plugin => plugin[1]
          .pop()
        parserOpts.offsidePluginOpts = offsidePluginOpts || default_offsidePluginOpts

    , visitor: ::
        Program(path) ::
          if this.opts.check_blocks :: ensureConsistentBlockIndent(path, path.node.body)

      , BlockStatement(path) ::
          if this.opts.check_blocks :: ensureConsistentBlockIndent(path, path.node.body)

      , SwitchStatement(path) ::
          if this.opts.check_blocks :: ensureConsistentBlockIndent(path, path.node.cases)

      , SwitchCase(path) ::
          if this.opts.check_blocks :: ensureConsistentBlockIndent(path, path.node.consequent)


export function ensureConsistentBlockIndent(path, body) ::
  if null == body :: body = path.node.body
  body = Array.from(body)
  if !body || !body.length :: return

  let prev_line, block_column=null
  for const child of body ::
    const loc = child.loc
    if !loc ::
      // A synthetic child often does not have a location.
      // Furthermore, a synthetic child indicates that something is mucking
      // around with the AST. Adapt by resetting block_column and enforcing
      // only across consecutive entries with valid locations.
      block_column = null
      continue
    else if null === block_column ::
      // assume the first location is indented properly…
      block_column = loc.start.column

    if loc.start.line != prev_line && loc.start.column != block_column ::
      throw path.hub.file.buildCodeFrameError @ child,
        `Indent mismatch. (block: ${block_column}, statement: ${loc.start.column}). \n` +
        `    (From 'check_blocks' enforcement option of babel-plugin-offside)`

    prev_line = loc.end.line

