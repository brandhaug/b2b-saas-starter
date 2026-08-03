import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import { listFiles } from './files.ts'

const sha256 = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex')

export const candidateConfigurationFiles = [
  'alchemy.run.ts',
  'infra/bindings.ts',
  'infra/topology.ts',
  'apps/web/wrangler.jsonc',
  'apps/merchant/wrangler.jsonc',
  'apps/operations/wrangler.jsonc',
  'apps/booking/wrangler.jsonc',
  'apps/api/wrangler.jsonc',
  'apps/background/wrangler.jsonc'
] as const

export const createCandidateManifest = async (input: {
  readonly root: string
  readonly commit: string
  readonly artifacts: readonly string[]
  readonly parityRevision: string
  readonly configurationFiles: readonly string[]
}) => {
  const migrationsDir = resolve(input.root, 'packages/db/migrations')
  const schemaBaseline = (await readdir(migrationsDir)).sort().at(-1)
  if (!schemaBaseline) throw new Error('no schema migration baseline found')
  const digestFiles = async (paths: readonly string[]) =>
    Object.fromEntries(
      await Promise.all(
        paths.map(async (path) => [
          relative(input.root, resolve(input.root, path)),
          sha256(await readFile(resolve(input.root, path)))
        ])
      )
    )
  const schemaFiles = (await listFiles(resolve(migrationsDir, schemaBaseline))).sort()
  if (schemaFiles.length === 0) throw new Error('schema migration baseline is empty')
  return {
    version: 1,
    product: 'beesolo',
    commit: input.commit,
    buildArtifacts: await digestFiles(input.artifacts),
    parityRevision: input.parityRevision,
    schemaBaseline: {
      name: basename(schemaBaseline),
      digest: sha256(JSON.stringify(await digestFiles(schemaFiles)))
    },
    configurationShape: sha256(
      JSON.stringify(await digestFiles(input.configurationFiles))
    )
  } as const
}
