import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, test, vi } from 'vite-plus/test'
import { digest, setup } from './setup-agent-skills.ts'

function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'skill-test-'))
  onTestFinished(() => {
    fs.rmSync(root, { recursive: true, force: true })
    vi.restoreAllMocks()
    syncBuiltinESMExports()
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const home = join(root, 'home')
  const repo = join(root, 'upstream')
  const skill = join(repo, 'skills/example')
  fs.mkdirSync(skill, { recursive: true })
  function git(...args: Array<string>) {
    return childProcess
      .execFileSync(
        'git',
        [
          '-C',
          repo,
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.test',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'core.hooksPath=/dev/null',
          ...args
        ],
        { encoding: 'utf8', stdio: 'pipe' }
      )
      .trim()
  }
  git('init', '--quiet')
  fs.writeFileSync(join(skill, 'SKILL.md'), 'Pinned instructions')
  fs.writeFileSync(join(skill, 'support.md'), 'Supporting instructions')
  fs.writeFileSync(join(skill, 'launcher'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  fs.symlinkSync('support.md', join(skill, 'support-link'))
  fs.writeFileSync(join(repo, 'LICENSE'), 'Primary license')
  fs.writeFileSync(join(repo, 'NOTICE.md'), 'Upstream notice')
  fs.writeFileSync(join(repo, 'EXTRA-LICENSE'), 'Additional license')
  function commit() {
    git('add', '.')
    git('commit', '--quiet', '-m', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  const revision = commit()
  const source = {
    repository: repo,
    revision,
    path: 'skills/example',
    licensePath: 'LICENSE',
    additionalLicenses: [
      {
        repository: repo,
        revision,
        path: 'EXTRA-LICENSE',
        destination: 'licenses/extra.LICENSE'
      }
    ]
  }
  const destination = join(home, '.agents/skills/example')
  const alias = join(home, '.claude/skills/example')
  function run(update = false) {
    return setup(home, update, { example: source })
  }
  return { root, home, repo, skill, source, destination, alias, run, commit }
}

test('copies pinned content, supporting files, licenses, modes and Claude alias', () => {
  const f = fixture()
  fs.writeFileSync(join(f.skill, 'SKILL.md'), 'Newer instructions')
  f.commit()
  assert.equal(f.run(), 0)
  for (const [name, content] of Object.entries({
    'SKILL.md': 'Pinned instructions',
    'support.md': 'Supporting instructions',
    LICENSE: 'Primary license',
    'NOTICE.md': 'Upstream notice',
    'licenses/extra.LICENSE': 'Additional license'
  })) {
    assert.equal(fs.readFileSync(join(f.destination, name), 'utf8'), content)
  }
  assert.ok(fs.statSync(join(f.destination, 'launcher')).mode & 0o111)
  assert.equal(fs.readlinkSync(join(f.destination, 'support-link')), 'support.md')
  assert.equal(fs.realpathSync(f.alias), fs.realpathSync(f.destination))
})

test('rerun preserves personal changes and repairs a missing alias without downloading', () => {
  const f = fixture()
  assert.equal(f.run(), 0)
  fs.rmSync(f.alias)
  fs.writeFileSync(join(f.destination, 'personal.md'), 'Keep this')
  fs.rmSync(f.repo, { recursive: true })
  assert.equal(f.run(), 0)
  assert.equal(fs.readFileSync(join(f.destination, 'personal.md'), 'utf8'), 'Keep this')
  assert.equal(fs.realpathSync(f.alias), fs.realpathSync(f.destination))
})

test('update replaces complete snapshots including deleted files', () => {
  const f = fixture()
  assert.equal(f.run(), 0)
  fs.rmSync(join(f.skill, 'support-link'))
  fs.rmSync(join(f.skill, 'support.md'))
  fs.writeFileSync(join(f.skill, 'SKILL.md'), 'Updated instructions')
  f.source.revision = f.commit()
  assert.equal(f.run(true), 0)
  assert.equal(
    fs.readFileSync(join(f.destination, 'SKILL.md'), 'utf8'),
    'Updated instructions'
  )
  assert.equal(fs.existsSync(join(f.destination, 'support.md')), false)
  assert.equal(f.run(true), 0)
})

for (const kind of ['content', 'permissions', 'symlink']) {
  test(`modified managed ${kind} is preserved on update`, () => {
    const f = fixture()
    assert.equal(f.run(), 0)
    if (kind === 'content') {
      fs.writeFileSync(join(f.destination, 'support.md'), 'Personal')
    }
    if (kind === 'permissions') {
      fs.chmodSync(join(f.destination, 'launcher'), 0o644)
    }
    if (kind === 'symlink') {
      fs.rmSync(join(f.destination, 'support-link'))
    }
    const before = digest(f.destination)
    assert.equal(f.run(true), 1)
    assert.equal(digest(f.destination), before)
  })
}

for (const kind of ['directory', 'file', 'symlink']) {
  test(`unmanaged ${kind} is preserved even with update`, () => {
    const f = fixture()
    fs.mkdirSync(join(f.home, '.agents/skills'), { recursive: true })
    if (kind === 'directory') {
      fs.mkdirSync(f.destination)
    }
    if (kind === 'file') {
      fs.writeFileSync(f.destination, 'Personal')
    }
    if (kind === 'symlink') {
      fs.symlinkSync(f.skill, f.destination)
    }
    assert.equal(f.run(), 1)
    assert.equal(f.run(true), 1)
    assert.ok(fs.lstatSync(f.destination))
  })
}

test('Claude alias collision prevents installing or overwriting the alias', () => {
  const f = fixture()
  fs.mkdirSync(join(f.home, '.claude/skills'), { recursive: true })
  fs.symlinkSync(join(f.root, 'missing-personal-skill'), f.alias)
  assert.equal(f.run(), 1)
  assert.equal(fs.existsSync(f.destination), false)
  assert.equal(fs.readlinkSync(f.alias), join(f.root, 'missing-personal-skill'))
})

test('a dangling alias to a deleted install reinstalls instead of colliding', () => {
  const f = fixture()
  assert.equal(f.run(), 0)
  fs.rmSync(f.destination, { recursive: true })
  assert.equal(fs.existsSync(f.destination), false)
  assert.ok(fs.lstatSync(f.alias).isSymbolicLink())
  assert.equal(f.run(), 0)
  assert.equal(
    fs.readFileSync(join(f.destination, 'SKILL.md'), 'utf8'),
    'Pinned instructions'
  )
  assert.equal(fs.realpathSync(f.alias), fs.realpathSync(f.destination))
})

test('Claude skills directory can link to the canonical skills directory', () => {
  const f = fixture()
  fs.mkdirSync(join(f.home, '.claude'), { recursive: true })
  fs.symlinkSync(join(f.home, '.agents/skills'), join(f.home, '.claude/skills'))
  assert.equal(f.run(), 0)
  assert.equal(f.run(true), 0)
  assert.equal(fs.realpathSync(f.alias), fs.realpathSync(f.destination))
  assert.ok(fs.lstatSync(join(f.home, '.claude/skills')).isSymbolicLink())
})

test('download failure preserves installed content and removes staging', () => {
  const f = fixture()
  assert.equal(f.run(), 0)
  const before = digest(f.destination)
  fs.rmSync(f.repo, { recursive: true })
  assert.equal(f.run(true), 1)
  assert.equal(digest(f.destination), before)
  assert.deepEqual(fs.readdirSync(join(f.home, '.agents/skills')), ['example'])
})

test('missing license fails without installing partial content', () => {
  const f = fixture()
  f.source.licensePath = 'MISSING'
  assert.equal(f.run(), 1)
  assert.equal(fs.existsSync(f.destination), false)
  assert.equal(fs.existsSync(f.alias), false)
  assert.deepEqual(fs.readdirSync(join(f.home, '.agents/skills')), [])
})

test('state-write failure rolls back the previous snapshot', () => {
  const f = fixture()
  assert.equal(f.run(), 0)
  const before = digest(f.destination)
  fs.writeFileSync(join(f.skill, 'SKILL.md'), 'Updated')
  f.source.revision = f.commit()
  const rename = fs.renameSync
  vi.spyOn(fs, 'renameSync').mockImplementation(
    (from: fs.PathLike, to: fs.PathLike) => {
      if (String(to).endsWith('skill-install-state.json')) {
        throw new Error('Disk full')
      }
      rename(from, to)
    }
  )
  syncBuiltinESMExports()
  assert.equal(f.run(true), 1)
  assert.equal(digest(f.destination), before)
  assert.equal(fs.realpathSync(f.alias), fs.realpathSync(f.destination))
})

test('repository revisions are downloaded once per run and use a timeout', () => {
  const f = fixture()
  const execute = childProcess.execFileSync
  const calls: Array<ReadonlyArray<string>> = []
  vi.spyOn(childProcess, 'execFileSync').mockImplementation(
    (
      file: string,
      args?: ReadonlyArray<string>,
      options?: childProcess.ExecFileSyncOptions
    ) => {
      calls.push(args ?? [])
      assert.equal(options?.timeout, 180_000)
      return execute(file, args ?? [], options)
    }
  )
  syncBuiltinESMExports()
  assert.equal(setup(f.home, false, { first: f.source, second: f.source }), 0)
  assert.equal(calls.filter((args) => args.includes('fetch')).length, 1)
})
