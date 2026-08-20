/**
 * Resolve `import './x.css'` to an empty module.
 *
 * Vite turns a CSS import into a side effect at build time; plain Node has
 * never heard of one and dies with ERR_UNKNOWN_FILE_EXTENSION. That single
 * fact is what kept the headless harnesses out of `tools/` and in a scratchpad
 * — every gate that wants to import a real UI-adjacent module hits it.
 *
 * Registered by `null-css.register.mjs`, which is passed to node via
 * `--import`, because a loader has to be installed before the graph it is
 * meant to rewrite starts resolving.
 */
export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {};' };
  return next(url, context);
}
