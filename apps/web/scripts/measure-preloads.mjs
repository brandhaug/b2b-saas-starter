// oxlint-disable effect/noNodeBuiltinImport -- a measurement script reads the repo's built output; it runs in Node by design, not in a Worker
// oxlint-disable eslint/no-console -- a CLI tool reports through the console by definition
// oxlint-disable eslint/no-await-in-loop -- each route is fetched and measured sequentially by design
// oxlint-disable effect/noTryCatch -- a CLI tool treats a missing chunk as a reported row, not an Effect failure
import { statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Preload-graph measurement against a running `vp preview` server.
 *
 * Usage: node scripts/measure-preloads.mjs <baseUrl> [route...]
 *   node scripts/measure-preloads.mjs http://localhost:3093 / /demo /sign-in /docs
 *
 * Fetches each route's SSR HTML, collects every <link rel="modulepreload">
 * href, resolves each against dist/client, and reports the count, the total
 * bytes, the ten largest chunks, and whether any chunk name matches
 * /capabilities|Schema/ — the client-boundary invariant: those graphs may
 * exist as lazy chunks (client navigations fetch loaders on demand) but must
 * never sit in a page's static preload set.
 *
 * Byte sizes are the built files on disk (gzip is what the wire sends; the
 * un-gzipped size is the stable, compression-independent budget signal).
 */

const CLIENT_DIR = fileURLToPath(new URL('../dist/client', import.meta.url))
const ROUTES = ['/', '/demo', '/sign-in', '/docs']

const baseUrl = process.argv[2]
if (!baseUrl) {
  console.error('usage: node scripts/measure-preloads.mjs <baseUrl> [route...]')
  console.error(
    '  e.g. node scripts/measure-preloads.mjs http://localhost:3093 / /demo'
  )
  process.exit(2)
}
const routes = process.argv.slice(3).length > 0 ? process.argv.slice(3) : ROUTES

function preloadHrefs(html) {
  const hrefs = []
  const pattern = /<link\s[^>]*rel="modulepreload"[^>]*>/g
  for (const tag of html.matchAll(pattern)) {
    const href = /href="([^"]+)"/.exec(tag[0])?.[1]
    if (href) {
      hrefs.push(href)
    }
  }
  return hrefs
}

let grandTotal = 0
let failed = false

for (const route of routes) {
  const url = new URL(route, baseUrl).toString()
  const response = await fetch(url)
  if (!response.ok) {
    console.error(
      `${route}: HTTP ${response.status} — is the preview server serving a production build?`
    )
    failed = true
    continue
  }
  const html = await response.text()
  const hrefs = [...new Set(preloadHrefs(html))]

  const chunks = hrefs.map((href) => {
    const pathname = decodeURIComponent(new URL(href, url).pathname)
    const file = join(CLIENT_DIR, ...pathname.split(posix.sep))
    try {
      return { href: pathname, bytes: statSync(file).size }
    } catch {
      console.error(`  ! ${pathname}: no such file under dist/client`)
      return { href: pathname, bytes: 0, missing: true }
    }
  })

  const total = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0)
  grandTotal += total
  const forbidden = chunks.filter((chunk) => /capabilities|Schema/.test(chunk.href))

  console.log(`${route}  ${chunks.length} preloads  ${(total / 1024).toFixed(1)} kB`)
  if (forbidden.length > 0 || chunks.some((chunk) => chunk.missing)) {
    failed = true
  }
  if (forbidden.length > 0) {
    console.log(
      `  !! client-boundary violation: ${forbidden.map((chunk) => chunk.href).join(', ')}`
    )
  }
  for (const chunk of chunks.toSorted((a, b) => b.bytes - a.bytes).slice(0, 10)) {
    console.log(`  ${String(chunk.bytes).padStart(8)}  ${chunk.href}`)
  }
}

console.log(
  `total across ${routes.length} routes: ${(grandTotal / 1024).toFixed(1)} kB`
)
if (failed) {
  process.exit(1)
}
