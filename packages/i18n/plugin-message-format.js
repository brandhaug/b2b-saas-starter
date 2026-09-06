// The inlang SDK evaluates local project modules from a data URL. Resolve the
// pinned workspace dependency from the package's working directory so catalog
// compilation remains deterministic and does not depend on a CDN at build time.
// oxlint-disable-next-line effect/noNodeBuiltinImport -- this build-only bridge resolves the local plugin package
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const modulePath = join(
  process.cwd(),
  'node_modules',
  '@inlang',
  'plugin-message-format',
  'dist',
  'index.js'
)
// oxlint-disable-next-line effect/noAsyncFunction -- inlang evaluates this local plugin bridge as an async module
const plugin = await import(pathToFileURL(modulePath).href)

export default plugin.default
