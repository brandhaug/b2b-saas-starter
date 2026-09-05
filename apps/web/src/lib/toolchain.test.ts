// oxlint-disable-next-line effect/noNodeBuiltinImport -- the guard reads the quickstart off the repo's content tree; a colocated test runs in Node, not in a Worker
import { readFileSync } from 'node:fs'
// oxlint-disable-next-line effect/noNodeBuiltinImport -- same: resolving the content path is a Node-side job, and the test never ships to the Worker
import { resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { SETUP_STEPS } from './toolchain'

/**
 * The quickstart is the canonical install story; the hero and closing block
 * print `SETUP_STEPS` as what it takes to run the starter. If a command here
 * stops appearing in the quickstart verbatim — renamed script, reordered
 * block, moved doc — one of the two is lying, and this test names the
 * mismatch instead of shipping a landing page the docs contradict.
 */
const quickstart = readFileSync(
  resolve(import.meta.dirname, '../../content/docs/getting-started/quickstart.mdx'),
  'utf8'
)

describe('SETUP_STEPS', () => {
  it('matches the quickstart command for command', () => {
    for (const step of SETUP_STEPS) {
      expect(quickstart).toContain(step)
    }
  })

  it('keeps the copy-paste order the quickstart prints', () => {
    const positions = SETUP_STEPS.map((step) => quickstart.indexOf(step))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions.toSorted((a, b) => a - b)).toEqual(positions)
  })
})
