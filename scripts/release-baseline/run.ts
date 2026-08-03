import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { renderIngressInventory } from './ingress.ts'

const root = resolve(import.meta.dirname, '../..')
const output = resolve(root, 'docs/generated/beesolo-production-ingress.md')
await mkdir(resolve(root, 'docs/generated'), { recursive: true })
await writeFile(output, renderIngressInventory())
const formatter = Bun.spawn(['bunx', 'oxfmt', '--write', output], {
  cwd: root,
  stdout: 'ignore',
  stderr: 'inherit'
})
if ((await formatter.exited) !== 0)
  throw new Error('failed to format ingress inventory')
process.stdout.write(`${output}\n`)
