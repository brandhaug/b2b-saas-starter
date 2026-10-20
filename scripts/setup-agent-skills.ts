import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

import { Schema } from 'effect'

import manifest from './agent-skills.json' with { type: 'json' }

type Source = {
  repository: string
  revision: string
  path: string
  licensePath: string
  additionalLicenses?: Array<{
    repository: string
    revision: string
    path: string
    destination: string
  }>
}
type State = Record<string, { digest: string; source: string }>

const decodeState = Schema.decodeUnknownSync(
  Schema.Record(
    Schema.String,
    Schema.Struct({ digest: Schema.String, source: Schema.String })
  )
)

function dependencyRoot(repo: string) {
  const root = resolve(repo)
  for (const path of [
    join(root, '.agents'),
    join(root, '.agents/skill-dependencies')
  ]) {
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(
        `Shared dependency directory preserved: ${path}; use a real checkout-local directory`
      )
    }
  }
  return join(root, '.agents/skill-dependencies')
}

function sourceDigest(source: Source): string {
  return createHash('sha256').update(JSON.stringify(source)).digest('hex')
}

/**
 * Resolve symlinks the way `realpathSync` does, and keep working for paths that
 * are about to be created by resolving the nearest existing ancestor instead.
 */
function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    // oxlint-disable-next-line unicorn/no-instanceof-builtins -- This synchronous Node filesystem call throws in the current realm; ES2023 typings omit Error.isError.
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error
    }
  }
  // A symlink whose target is gone still resolves to that target: the alias
  // stays comparable to the install path instead of reading as a foreign entry.
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (stat?.isSymbolicLink()) {
    return canonical(resolve(dirname(path), readlinkSync(path)))
  }
  return join(canonical(dirname(path)), basename(path))
}

export function digest(folder: string): string {
  const hash = createHash('sha256')
  function visit(directory: string) {
    for (const name of readdirSync(directory).toSorted()) {
      const path = join(directory, name)
      const stat = lstatSync(path)
      const key = relative(folder, path).split(sep).join('/')
      let value: Array<string | number> = [key, 'directory']
      if (stat.isSymbolicLink()) {
        value = [key, 'link', readlinkSync(path)]
      } else if (stat.isFile()) {
        value = [
          key,
          'file',
          stat.mode & 0o111,
          createHash('sha256').update(readFileSync(path)).digest('hex')
        ]
      }
      hash.update(`${JSON.stringify(value)}\n`)
      if (stat.isDirectory()) {
        visit(path)
      }
    }
  }
  visit(folder)
  return hash.digest('hex')
}

function fetchSource(
  repository: string,
  revision: string,
  cache: Map<string, string>,
  temporary: string
) {
  const key = JSON.stringify([repository, revision])
  const cached = cache.get(key)
  if (cached) {
    return cached
  }
  if (!/^[\da-f]{40}$/.test(revision)) {
    throw new Error('Manifest revision must be a full commit SHA')
  }
  const checkout = join(temporary, String(cache.size))
  for (const args of [
    ['init', '--quiet', checkout],
    ['-C', checkout, 'fetch', '--quiet', '--depth=1', repository, revision],
    [
      '-C',
      checkout,
      '-c',
      'core.hooksPath=/dev/null',
      'checkout',
      '--quiet',
      '--detach',
      'FETCH_HEAD'
    ]
  ]) {
    execFileSync('git', args, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 180_000,
      stdio: 'pipe'
    })
  }
  cache.set(key, checkout)
  return checkout
}

function inside(folder: string, path: string) {
  const target = join(folder, path)
  const fromRoot = relative(canonical(folder), canonical(target))
  if (
    isAbsolute(path) ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`Path escapes source folder: ${path}`)
  }
  return target
}

function prepare(
  source: Source,
  stage: string,
  cache: Map<string, string>,
  temporary: string
) {
  const checkout = fetchSource(source.repository, source.revision, cache, temporary)
  cpSync(inside(checkout, source.path), stage, {
    recursive: true,
    verbatimSymlinks: true
  })
  if (!existsSync(join(stage, 'SKILL.md'))) {
    throw new Error('Upstream skill has no SKILL.md')
  }
  function validateLinks(directory: string) {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      const entry = lstatSync(path)
      if (entry.isSymbolicLink()) {
        const target = readlinkSync(path)
        if (isAbsolute(target)) {
          throw new Error(`Absolute skill symlink: ${path}`)
        }
        inside(stage, relative(stage, path))
      } else if (entry.isDirectory()) {
        validateLinks(path)
      }
    }
  }
  validateLinks(stage)
  const license = inside(checkout, source.licensePath)
  const additions: Array<[string, string]> = [[license, join(stage, basename(license))]]
  for (const name of ['NOTICE', 'NOTICE.md']) {
    if (existsSync(join(checkout, name))) {
      additions.push([inside(checkout, name), join(stage, name)])
    }
  }
  for (const extra of source.additionalLicenses ?? []) {
    const repo = fetchSource(extra.repository, extra.revision, cache, temporary)
    additions.push([inside(repo, extra.path), inside(stage, extra.destination)])
  }
  for (const [original, target] of additions) {
    if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) {
      rmSync(target)
    }
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(original, target)
  }
}

function readState(path: string): State {
  return existsSync(path) ? decodeState(JSON.parse(readFileSync(path, 'utf8'))) : {}
}

function status(name: string, source: Source, root: string, state: State) {
  const destination = join(root, name)
  const present = lstatSync(destination, { throwIfNoEntry: false })
  if (!present) {
    return 'missing'
  }
  const previous = state[name]
  if (present.isSymbolicLink() || !present.isDirectory() || !previous) {
    return 'unmanaged'
  }
  if (digest(destination) !== previous.digest) {
    return 'modified'
  }
  return sourceDigest(source) === previous.source ? 'verified' : 'stale'
}

function install(
  name: string,
  source: Source,
  root: string,
  update: boolean,
  state: State,
  cache: Map<string, string>,
  temporary: string
) {
  const destination = join(root, name)
  const current = status(name, source, root, state)
  if (current === 'verified') {
    return 'verified'
  }
  if (current === 'unmanaged' || current === 'modified') {
    throw new Error(
      `${current} installation preserved: ${destination}; move it aside or restore the managed snapshot before setup`
    )
  }
  if (current === 'stale' && !update) {
    throw new Error(
      `stale manifest source: ${destination}; run skills:setup --update ${name}`
    )
  }
  const present = current === 'stale'
  mkdirSync(root, { recursive: true })
  const work = mkdtempSync(join(dirname(destination), '.skill-install-'))
  const stage = join(work, 'skill')
  const backup = join(work, 'previous')
  const statePath = join(root, 'skill-install-state.json')
  const stateTemporary = join(work, 'state.json')
  try {
    prepare(source, stage, cache, temporary)
    const entry = { digest: digest(stage), source: sourceDigest(source) }
    if (present) {
      renameSync(destination, backup)
    }
    try {
      renameSync(stage, destination)
      writeFileSync(
        stateTemporary,
        `${JSON.stringify({ ...state, [name]: entry }, null, 2)}\n`
      )
      renameSync(stateTemporary, statePath)
    } catch (error) {
      rmSync(destination, { recursive: true, force: true })
      if (present) {
        renameSync(backup, destination)
      }
      throw error
    }
    state[name] = entry
    return present ? 'updated' : 'installed'
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function selected(sources: Record<string, Source>, names?: Array<string>) {
  return (names?.length ? [...new Set(names)] : Object.keys(sources)).map((name) => {
    if (!/^[a-z\d][a-z\d-]*$/.test(name)) {
      throw new Error(`Invalid skill name: ${name}`)
    }
    const source = sources[name]
    if (!Object.hasOwn(sources, name) || !source) {
      throw new Error(`Unknown skill: ${name}; check scripts/agent-skills.json`)
    }
    return [name, source] satisfies [string, Source]
  })
}

export function verify(
  repo: string,
  sources: Record<string, Source> = manifest,
  names?: Array<string>
): number {
  try {
    const entries = selected(sources, names)
    const root = dependencyRoot(repo)
    const state = readState(join(root, 'skill-install-state.json'))
    let failures = 0
    for (const [name, source] of entries) {
      const current = status(name, source, root, state)
      if (current === 'verified') {
        console.log(`${name}: verified`)
      } else {
        let action =
          'restore the managed snapshot or move the preserved installation aside'
        if (current === 'missing') {
          action = `run skills:setup ${name}`
        }
        if (current === 'stale') {
          action = `run skills:setup --update ${name}`
        }
        console.error(`${name}: ${current}; ${action}`)
        failures += 1
      }
    }
    return failures > 0 ? 1 : 0
  } catch (error) {
    console.error('Cannot verify skills:', error)
    return 1
  }
}

export function setup(
  repo: string,
  update = false,
  sources: Record<string, Source> = manifest,
  names?: Array<string>
): number {
  let temporary: string | undefined
  let ownedLock: string | undefined
  try {
    const entries = selected(sources, names)
    const root = dependencyRoot(repo)
    mkdirSync(root, { recursive: true })
    const lock = join(root, '.setup-lock')
    try {
      mkdirSync(lock)
    } catch (error) {
      throw new Error(
        `Cannot acquire setup lock ${lock}; another setup may be running. If it has stopped, remove the stale lock and retry.`,
        { cause: error }
      )
    }
    ownedLock = lock
    const state = readState(join(root, 'skill-install-state.json'))
    temporary = mkdtempSync(join(tmpdir(), 'agent-skill-sources-'))
    const cache = new Map<string, string>()
    let failures = 0
    for (const [name, source] of entries) {
      try {
        console.log(
          `${name}: ${install(name, source, root, update, state, cache, temporary)}`
        )
      } catch (error) {
        console.error(name, error)
        failures += 1
      }
    }
    return failures > 0 ? 1 : 0
  } catch (error) {
    console.error('Cannot install skills:', error)
    return 1
  } finally {
    if (ownedLock) {
      rmSync(ownedLock, { recursive: true, force: true })
    }
    if (temporary) {
      rmSync(temporary, { recursive: true, force: true })
    }
  }
}

if (import.meta.main) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        repo: { type: 'string', default: resolve(import.meta.dirname, '..') },
        update: { type: 'boolean', default: false },
        verify: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h' }
      }
    })
    if (values.verify && values.update) {
      throw new Error('--verify cannot be combined with --update')
    }
    if (values.help) {
      console.log(
        'Usage: node scripts/setup-agent-skills.ts [--repo PATH] [--update | --verify] [SKILL ...]\nInstall pinned dependencies into <repo>/.agents/skill-dependencies.\n--verify checks ownership, source and content offline without writing.\n--update replaces only unchanged managed snapshots when their manifest changes.'
      )
    } else {
      process.exitCode = values.verify
        ? verify(values.repo, manifest, positionals)
        : setup(values.repo, values.update, manifest, positionals)
    }
  } catch (error) {
    console.error('Cannot manage skills:', error)
    process.exitCode = 1
  }
}
