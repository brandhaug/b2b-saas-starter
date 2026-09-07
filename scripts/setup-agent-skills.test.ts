import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { digest, setup } from './setup-agent-skills.ts'

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(join(tmpdir(), 'skill-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
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

function impeccableFixture(t: TestContext) {
  const f = fixture(t)
  fs.mkdirSync(join(f.skill, 'scripts'), { recursive: true })
  fs.writeFileSync(join(f.skill, 'scripts/VERSION'), '0.1.3\n')
  fs.writeFileSync(
    join(f.skill, 'scripts/impeccable'),
    '#!/bin/sh\nif [ "$1" = engine-probe ]; then\n  mkdir -p "$IMPECCABLE_HOME/bin/0.1.3"\n  printf cached > "$IMPECCABLE_HOME/bin/0.1.3/engine"\n  printf "impeccable-engine 0.1.3\\n"\n  exit 0\nfi\nexit 0\n',
    { mode: 0o755 }
  )
  const source = f.source
  source.revision = f.commit()
  source.path = 'skills/example'
  function runImpeccable(update = false) {
    return setup(f.home, update, { impeccable: source })
  }
  const destination = join(f.home, '.agents/skills/impeccable')
  const alias = join(f.home, '.claude/skills/impeccable')
  return { ...f, source, destination, alias, run: runImpeccable }
}

await test('bootstraps the pinned Impeccable engine into the selected home', (t) => {
  const f = impeccableFixture(t)
  const originalHome = process.env.HOME
  assert.equal(f.run(), 0)
  assert.equal(process.env.HOME, originalHome)
  assert.equal(
    fs.readFileSync(join(f.home, '.impeccable/bin/0.1.3/engine'), 'utf8'),
    'cached'
  )
})

await test('engine bootstrap failure preserves the previous install and state', (t) => {
  const f = impeccableFixture(t)
  assert.equal(f.run(), 0)
  const before = digest(f.destination)
  const stateBefore = fs.readFileSync(
    join(f.home, '.agents/skill-install-state.json'),
    'utf8'
  )
  fs.writeFileSync(
    join(f.skill, 'scripts/impeccable'),
    '#!/bin/sh\nprintf "no\\n"\nexit 23\n',
    { mode: 0o755 }
  )
  f.source.revision = f.commit()
  assert.equal(f.run(true), 1)
  assert.equal(digest(f.destination), before)
  assert.equal(
    fs.readFileSync(join(f.home, '.agents/skill-install-state.json'), 'utf8'),
    stateBefore
  )
  assert.equal(fs.realpathSync(f.alias), fs.realpathSync(f.destination))
})

await test('rejects a successful probe for the wrong engine version', (t) => {
  const f = impeccableFixture(t)
  fs.writeFileSync(
    join(f.skill, 'scripts/impeccable'),
    '#!/bin/sh\nprintf "impeccable-engine 0.1.2\\n"\n',
    { mode: 0o755 }
  )
  f.source.revision = f.commit()
  assert.equal(f.run(), 1)
  assert.equal(fs.existsSync(f.destination), false)
})

await test('does not execute a modified managed launcher on rerun', (t) => {
  const f = impeccableFixture(t)
  assert.equal(f.run(), 0)
  fs.rmSync(join(f.home, '.impeccable'), { recursive: true })
  fs.writeFileSync(
    join(f.destination, 'scripts/impeccable'),
    '#!/bin/sh\nmkdir -p "$IMPECCABLE_HOME/should-not-exist"\nexit 0\n',
    { mode: 0o755 }
  )
  assert.equal(f.run(), 1)
  assert.equal(fs.existsSync(join(f.home, '.impeccable')), false)
})

await test('managed Impeccable reruns repair a missing engine cache', (t) => {
  const f = impeccableFixture(t)
  assert.equal(f.run(), 0)
  fs.rmSync(join(f.home, '.impeccable'), { recursive: true })
  fs.rmSync(f.repo, { recursive: true })
  assert.equal(f.run(), 0)
  assert.equal(fs.existsSync(join(f.home, '.impeccable/bin/0.1.3/engine')), true)
})

await test('copies pinned content, supporting files, licenses, modes and Claude alias', (t) => {
  const f = fixture(t)
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

await test('rerun preserves personal changes and repairs a missing alias without downloading', (t) => {
  const f = fixture(t)
  assert.equal(f.run(), 0)
  fs.rmSync(f.alias)
  fs.writeFileSync(join(f.destination, 'personal.md'), 'Keep this')
  fs.rmSync(f.repo, { recursive: true })
  assert.equal(f.run(), 0)
  assert.equal(fs.readFileSync(join(f.destination, 'personal.md'), 'utf8'), 'Keep this')
  assert.equal(fs.realpathSync(f.alias), fs.realpathSync(f.destination))
})

await test('update replaces complete snapshots including deleted files', (t) => {
  const f = fixture(t)
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
  await test(`modified managed ${kind} is preserved on update`, (t) => {
    const f = fixture(t)
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
  await test(`unmanaged ${kind} is preserved even with update`, (t) => {
    const f = fixture(t)
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

await test('Claude alias collision prevents installing or overwriting the alias', (t) => {
  const f = fixture(t)
  fs.mkdirSync(join(f.home, '.claude/skills'), { recursive: true })
  fs.symlinkSync(join(f.root, 'missing-personal-skill'), f.alias)
  assert.equal(f.run(), 1)
  assert.equal(fs.existsSync(f.destination), false)
  assert.equal(fs.readlinkSync(f.alias), join(f.root, 'missing-personal-skill'))
})

await test('Claude skills directory can link to the canonical skills directory', (t) => {
  const f = fixture(t)
  fs.mkdirSync(join(f.home, '.claude'), { recursive: true })
  fs.symlinkSync(join(f.home, '.agents/skills'), join(f.home, '.claude/skills'))
  assert.equal(f.run(), 0)
  assert.equal(f.run(true), 0)
  assert.equal(fs.realpathSync(f.alias), fs.realpathSync(f.destination))
  assert.ok(fs.lstatSync(join(f.home, '.claude/skills')).isSymbolicLink())
})

await test('download failure preserves installed content and removes staging', (t) => {
  const f = fixture(t)
  assert.equal(f.run(), 0)
  const before = digest(f.destination)
  fs.rmSync(f.repo, { recursive: true })
  assert.equal(f.run(true), 1)
  assert.equal(digest(f.destination), before)
  assert.deepEqual(fs.readdirSync(join(f.home, '.agents/skills')), ['example'])
})

await test('missing license fails without installing partial content', (t) => {
  const f = fixture(t)
  f.source.licensePath = 'MISSING'
  assert.equal(f.run(), 1)
  assert.equal(fs.existsSync(f.destination), false)
  assert.equal(fs.existsSync(f.alias), false)
  assert.deepEqual(fs.readdirSync(join(f.home, '.agents/skills')), [])
})

await test('state-write failure rolls back the previous snapshot', (t) => {
  const f = fixture(t)
  assert.equal(f.run(), 0)
  const before = digest(f.destination)
  fs.writeFileSync(join(f.skill, 'SKILL.md'), 'Updated')
  f.source.revision = f.commit()
  const rename = fs.renameSync
  t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to).endsWith('skill-install-state.json')) {
      throw new Error('Disk full')
    }
    rename(from, to)
  })
  syncBuiltinESMExports()
  try {
    assert.equal(f.run(true), 1)
    assert.equal(digest(f.destination), before)
    assert.equal(fs.realpathSync(f.alias), fs.realpathSync(f.destination))
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})

await test('repository revisions are downloaded once per run and use a timeout', (t) => {
  const f = fixture(t)
  const execute = childProcess.execFileSync
  const calls: Array<ReadonlyArray<string>> = []
  t.mock.method(
    childProcess,
    'execFileSync',
    (
      file: string,
      args: ReadonlyArray<string>,
      options: childProcess.ExecFileSyncOptions
    ) => {
      calls.push(args)
      assert.equal(options.timeout, 180_000)
      return execute(file, args, options)
    }
  )
  syncBuiltinESMExports()
  try {
    assert.equal(setup(f.home, false, { first: f.source, second: f.source }), 0)
    assert.equal(calls.filter((args) => args.includes('fetch')).length, 1)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})
