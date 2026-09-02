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
 * Deliberately NOT a marker: `better-auth` — the Better Auth *client* SDK
 * (`better-auth/react`) legitimately ships in `auth-client.ts`, and the bare
 * string also appears in docs prose, so it cannot distinguish server from
 * client.
 */

const MARKERS = ['@react-email', 'css-tree', '@b2b-saas-starter/email/templates']

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
      'A lib/server module is being imported statically by client code again.',
      'Server functions must reach their effects via dynamic import() inside',
      'the handler (see lib/server/invitations.ts for the reference split).'
    ].join('\n')
  )
  process.exit(1)
}

console.log('client bundle boundary OK: no server-only modules in dist/client')
