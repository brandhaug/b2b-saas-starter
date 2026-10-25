import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, test } from 'vite-plus/test'
import { inventorySource } from './suppression-inventory.ts'

test('reads actual comments without counting literal or JSX text', () => {
  const source = [
    'const string = "// oxlint-disable bogus"',
    'const template = `/* @ts-ignore */`',
    'const regex = /[/*] oxlint-disable fake/',
    'const jsx = <div>// oxlint-disable fake</div>',
    '// oxlint-disable-next-line real -- native callback boundary',
    'run()'
  ].join('\n')
  const rows = inventorySource('fixture.tsx', source)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.line, 5)
  assert.equal(rows[0].scope, 'next line')
  assert.equal(rows[0].reason, 'native callback boundary')
})

test('preserves multiline rules, adjacent reasons and explicit range controls', () => {
  const rows = inventorySource(
    'fixture.ts',
    [
      '// Native adapter runs outside Effect.',
      '/* oxlint-disable',
      ' * effect/noAsyncFunction, effect/noGlobals',
      ' */',
      'run()',
      '/* oxlint-enable effect/noGlobals */',
      '// unrelated explanation',
      '',
      '// oxlint-disable-next-line other',
      'run() // eslint-disable-line rule -- inline reason',
      '/* oxlint-disable-next-line third -- a multiline',
      ' * explanation with | punctuation */',
      'run()'
    ].join('\n')
  )
  assert.equal(rows.length, 5)
  assert.deepEqual(rows[0]?.rules, ['effect/noAsyncFunction', 'effect/noGlobals'])
  assert.equal(rows[0].scope, 'file from directive; see enable controls')
  assert.equal(rows[0].reason, 'Native adapter runs outside Effect.')
  assert.equal(rows[1]?.scope, 'restore rules from directive')
  assert.equal(rows[2]?.reason, '')
  assert.equal(rows[3]?.scope, 'same line')
  assert.equal(rows[4]?.reason, 'a multiline explanation with | punctuation')
})

test('recognizes TypeScript negative tests and Effect off settings', () => {
  const rows = inventorySource(
    'boundary.test.ts',
    [
      '// @ts-expect-error Deliberately pass malformed input.',
      'run(null)',
      '// @effect-diagnostics-next-line floatingEffect:off missingEffectContext:error -- negative fixture',
      'run()',
      '/* @effect-diagnostics *:off -- adapter */',
      '// @effect-diagnostics floatingEffect:warning',
      '// @ts-ignore: temporary workaround',
      'run()',
      '/* @ts-nocheck -- upstream fixture */'
    ].join('\n')
  )
  assert.equal(rows.length, 5)
  assert.equal(rows[0]?.category, 'negative type test')
  assert.equal(rows[0].reason, 'Deliberately pass malformed input.')
  assert.deepEqual(rows[1]?.rules, ['floatingEffect'])
  assert.equal(rows[1].scope, 'next line')
  assert.equal(rows[2]?.scope, 'whole file')
  assert.equal(rows[3]?.category, 'temporary debt marker')
  assert.equal(rows[4]?.scope, 'whole file')
})

test('associates only contiguous comment explanations on either side', () => {
  const rows = inventorySource(
    'fixture.ts',
    [
      '// oxlint-disable-next-line first',
      '// SAFETY: external callback validates the value.',
      'run()',
      '// Explanation separated by code.',
      'run()',
      '// oxlint-disable-next-line second',
      'run()',
      '// oxlint-disable-next-line third -- explicit reason',
      '// Further detail.',
      'run()'
    ].join('\n')
  )
  assert.equal(rows[0]?.reason, 'SAFETY: external callback validates the value.')
  assert.equal(rows[1]?.reason, '')
  assert.equal(rows[2]?.reason, 'explicit reason Further detail.')
})

test('CLI generates deterministic linked output, excludes owned generated paths and rejects drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'suppression-inventory-'))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '--quiet', root])
  const files = {
    'src/handwritten.d.ts': '// @ts-ignore -- external declaration boundary\nexport {}',
    'src/z.ts': '// oxlint-disable-next-line rule -- reason\nrun()',
    'vendor/other.ts': '// @ts-nocheck',
    'apps/web/src/routeTree.gen.ts': '// @ts-nocheck',
    'packages/i18n/src/generated/messages.ts': '// @ts-nocheck',
    'node_modules/other/index.ts': '// @ts-nocheck'
  }
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), source)
  }
  execFileSync('git', ['-C', root, 'add', '.'])
  const script = join(import.meta.dirname, 'suppression-inventory.ts')
  function run(mode: string) {
    return spawnSync(process.execPath, [script, mode, '--root', root], {
      encoding: 'utf8'
    })
  }
  assert.equal(run('--write').status, 0)
  const report = readFileSync(join(root, 'docs/generated/suppressions.md'), 'utf8')
  assert.match(report, /handwritten\.d\.ts#L1/)
  assert.doesNotMatch(report, /\[.*(?:routeTree|vendor|messages\.ts|node_modules)/)
  assert.equal(run('--check').status, 0)
  assert.equal(run('--write').status, 0)
  assert.equal(
    readFileSync(join(root, 'docs/generated/suppressions.md'), 'utf8'),
    report
  )
  writeFileSync(
    join(root, 'src/z.ts'),
    '// oxlint-disable-next-line rule -- changed reason\nrun()'
  )
  assert.equal(run('--check').status, 1)
})
