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
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
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
type State = Record<string, { digest: string }>

const decodeState = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Struct({ digest: Schema.String }))
)

function exists(path: string) {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined
}

/**
 * Resolve symlinks the way `realpathSync` does, and keep working for paths that
 * are about to be created by resolving the nearest existing ancestor instead.
 */
function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return join(canonical(dirname(path)), basename(path))
  }
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

function install(
  name: string,
  source: Source,
  home: string,
  update: boolean,
  state: State,
  cache: Map<string, string>,
  temporary: string
) {
  if (!/^[a-z\d][a-z\d-]*$/.test(name)) {
    throw new Error(`Invalid skill name: ${name}`)
  }
  const destination = join(home, '.agents/skills', name)
  const alias = join(home, '.claude/skills', name)
  if (exists(alias) && canonical(alias) !== canonical(destination)) {
    throw new Error(`Claude alias collision: ${alias}`)
  }
  const present = lstatSync(destination, { throwIfNoEntry: false })
  if (present) {
    const previous = state[name]
    if (present.isSymbolicLink() || !present.isDirectory() || !previous) {
      throw new Error(`Unmanaged installation preserved: ${destination}`)
    }
    if (!update) {
      if (!exists(alias)) {
        mkdirSync(dirname(alias), { recursive: true })
        symlinkSync(destination, alias)
      }
      return 'already installed; use --update to refresh'
    }
    if (digest(destination) !== previous.digest) {
      throw new Error(`Personal modifications preserved: ${destination}`)
    }
  }
  mkdirSync(dirname(destination), { recursive: true })
  mkdirSync(dirname(alias), { recursive: true })
  const work = mkdtempSync(join(dirname(destination), '.skill-install-'))
  const stage = join(work, 'skill')
  const backup = join(work, 'previous')
  const statePath = join(home, '.agents/skill-install-state.json')
  const stateTemporary = join(work, 'state.json')
  try {
    prepare(source, stage, cache, temporary)
    const entry = { digest: digest(stage) }
    if (present) {
      renameSync(destination, backup)
    }
    let aliasCreated = false
    try {
      renameSync(stage, destination)
      if (!exists(alias)) {
        symlinkSync(destination, alias)
        aliasCreated = true
      }
      writeFileSync(
        stateTemporary,
        `${JSON.stringify({ ...state, [name]: entry }, null, 2)}\n`
      )
      renameSync(stateTemporary, statePath)
    } catch (error) {
      if (aliasCreated) {
        rmSync(alias)
      }
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

export function setup(
  home: string,
  update = false,
  sources: Record<string, Source> = manifest
): number {
  const state = readState(join(home, '.agents/skill-install-state.json'))
  const temporary = mkdtempSync(join(tmpdir(), 'agent-skill-sources-'))
  let failures = 0
  try {
    const cache = new Map<string, string>()
    for (const [name, source] of Object.entries(sources)) {
      try {
        console.log(
          `${name}: ${install(name, source, resolve(home), update, state, cache, temporary)}`
        )
      } catch (error) {
        console.error(name, error)
        failures += 1
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
  return failures > 0 ? 1 : 0
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        home: { type: 'string', default: homedir() },
        update: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h' }
      }
    })
    if (values.help) {
      console.log(
        'Usage: node scripts/setup-agent-skills.ts [--home PATH] [--update]\nInstall pinned skills into ~/.agents/skills with Claude aliases.\n--update refreshes unchanged managed skills and preserves personal changes.\n--home selects an isolated installation home.'
      )
    } else {
      process.exitCode = setup(values.home, values.update)
    }
  } catch (error) {
    console.error('Cannot install skills:', error)
    process.exitCode = 1
  }
}
