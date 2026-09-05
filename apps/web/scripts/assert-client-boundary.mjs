// oxlint-disable effect/noNodeBuiltinImport -- a build-guard script reads the repo's built output; it runs in Node by design, not in a Worker
// oxlint-disable eslint/no-console -- a CLI guard reports through the console by definition
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Client bundle boundary assertion (run automatically after `pnpm build`).
 *
 * The web app's client graph must never contain server-only modules. The
 * server functions in `lib/server/*.ts` reach their effects through dynamic
 * `import()` inside handlers — TanStack Start strips handler bodies from the
 * client build, so if any of these markers show up in `dist/client`, that
 * split has regressed and the browser is shipping the server again.
 *
 * Markers are substrings that cannot occur in app chunks or docs prose:
 *
 * - `@react-email` — the invitation email template graph
 *   (`lib/server/invitations.effects.ts`); historically a 1.3 MB entry-chunk
 *   leak that shipped on every page.
 * - `css-tree` — a react-email transitive dependency, same graph.
 * - `@b2b-saas-starter/email/templates` — the templates surface only the
 *   server effects (and docs prose, which this never matched because prose
 *   spells the package without the `/templates` subpath… guard kept exact).
 *
 * The capabilities / Effect Schema invariant (the loader code-split removal
 * made this load-bearing: the route tree's static graph ships on every page).
 * One marker is not enough — minified `effect` mangles its namespace, so the
 * Schema chunk can ship without any obvious `Schema.*` name. The set below
 * covers the three violation shapes observed in this repo, each verified
 * absent from a clean `dist/client` and present in a deliberately violated
 * one (a route loader statically importing an `.effects` module):
 *
 * - `capability.workspace` — the capabilities runtime's wide-event scope; the
 *   full workspace graph ships with it (the historical `capabilities-*.js`
 *   155 kB preload).
 * - `no_principal`, `insufficient_permission` — the authz/capabilities
 *   `Schema.TaggedError` reason literals; a bare error-class pin (a client
 *   component importing `@b2b-saas-starter/authz/errors` at runtime) ships
 *   exactly these strings. `httpApiStatus` — the third literal on those
 *   classes — was rejected: the `/docs` effect-backbone pages quote it in
 *   MDX code samples, so it matches docs content chunks on a clean build.
 * - `isMinLength` — a `Schema` filter combinator called as a property in
 *   capabilities/effects source; minification keeps the property name, so any
 *   Schema-using capability code that ships carries it.
 * - `onExcessProperty`, `unsafePreserveChecks` — Schema internals that ship
 *   with the *minimal* schema construct (`Schema.Struct({ x: Schema.String })`
 *   — no filters, no NonEmptyString), verified present in a deliberately
 *   leaked plain struct and absent from a clean build, docs prose, and every
 *   bundled vendor dist. These close the hole `isMinLength` alone left: the
 *   client-safe halves' validators are Effect Schemas stripped from the
 *   client build by the TanStack compiler, so a regression here is exactly
 *   "a schema construct shipped", and these two names ride along with any
 *   construct, filters or not. (`toJsonSchema` was verified too but rejected:
 *   other validator libraries implement the same method name, so it would
 *   false-positive on a legitimately bundled validator.)
 *
 * If a marker starts matching docs prose (the `/docs` routes bundle MDX into
 * client chunks — `TaggedError` was rejected for exactly that reason), pick
 * another literal from `packages/capabilities` and re-verify both directions.
 *
 * Deliberately NOT markers: `better-auth` — the Better Auth *client* SDK
 * (`better-auth/react`) legitimately ships in `auth-client.ts`, and the bare
 * string also appears in docs prose, so it cannot distinguish server from
 * client. Chunk *names* are not checked either: `grep capabilities|Schema`
 * over file names has no false positives today, but the bundler inlines these
 * graphs into shared chunks as readily as it names one after them, so a name
 * is an accident of chunking, not a property of the code inside it.
 *
 * Byte budget: intentionally NOT enforced here. The root route's static
 * import graph is only observable by fetching a built page's modulepreload
 * set — `scripts/measure-preloads.mjs` does that against a running
 * `vp preview` and owns the budget signal.
 */

const MARKERS = [
  '@react-email',
  'css-tree',
  '@b2b-saas-starter/email/templates',
  'capability.workspace',
  'no_principal',
  'insufficient_permission',
  'isMinLength',
  'onExcessProperty',
  'unsafePreserveChecks'
]

const CLIENT_DIR = new URL('../dist/client', import.meta.url)

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, files)
    } else if (entry.endsWith('.js')) {
      files.push(full)
    }
  }
  return files
}

const offenders = []
for (const file of walk(CLIENT_DIR.pathname)) {
  const contents = readFileSync(file, 'utf8')
  for (const marker of MARKERS) {
    if (contents.includes(marker)) {
      offenders.push(`${file} contains ${marker}`)
    }
  }
}

if (offenders.length > 0) {
  console.error(
    [
      'Client bundle boundary violated — server-only modules shipped to dist/client:',
      ...offenders.map((line) => `  - ${line}`),
      '',
      'A capabilities or Effect Schema graph is in the client bundle again.',
      'lib/server modules must stay client-safe at module level: the server fn',
      'keeps createServerFn, type imports, and its Effect Schema validators (the',
      'TanStack compiler strips .validator() from the client build — these',
      'markers are the proof it did), and its behavior lives in a sibling',
      '.effects.ts reached by dynamic import(). Components read vocabularies',
      'from Schema-free leaves (@b2b-saas-starter/db/enums,',
      'capabilities .../webhook-events).'
    ].join('\n')
  )
  process.exit(1)
}

console.log('client bundle boundary OK: no server-only modules in dist/client')
