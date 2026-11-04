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
 * - `react-email.element` — the component marker in React Email 6, which
 *   consolidates components into `react-email` instead of scoped packages.
 * - `css-tree` — a react-email transitive dependency, same graph.
 * - `@b2b-saas-starter/email/templates` — the templates surface only the
 *   server effects (and docs prose, which this never matched because prose
 *   spells the package without the `/templates` subpath… guard kept exact).
 *
 * Effect and Schema are supported browser dependencies. Markers identify
 * server execution instead: `capability.workspace` belongs to the server
 * capability runtime, and the Database/RawD1 service IDs identify storage
 * services. Schema constructors, brands and error contracts are allowed.
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
 * set from a running preview, not from the build output this script reads.
 */

const MARKERS = [
  '@react-email',
  'react-email.element',
  'css-tree',
  '@b2b-saas-starter/email/templates',
  'capability.workspace',
  '@b2b-saas-starter/db/Database',
  '@b2b-saas-starter/db/RawD1'
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
      'Effect Schema is allowed. Database services, email rendering and the',
      'server capability runtime are not. Keep server behavior in sibling',
      '.effects.ts modules reached through dynamic imports in server handlers.'
    ].join('\n')
  )
  process.exit(1)
}

console.log('client bundle boundary OK: no server-only modules in dist/client')
