import assert from 'node:assert/strict'
import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  captureCli,
  extractResponse,
  parseCli,
  runEvaluation,
  type Host
} from './evaluate-agent-workflow.ts'

function cliArgs(host: string) {
  return [
    '--host',
    host,
    '--model',
    'model',
    '--skill',
    'skill.md',
    '--output',
    'evidence'
  ]
}

void test('parses every supported CLI host and rejects invalid or missing values', () => {
  const hosts: ReadonlyArray<Host> = ['codex', 'claude', 'opencode']
  for (const host of hosts) {
    assert.equal(parseCli(cliArgs(host)).host, host)
  }
  assert.throws(() => parseCli(cliArgs('other')))
  assert.throws(() => parseCli(['--host', 'codex']))
})

void test('requires a successful Codex turn and validates the fixture result shape', () => {
  const output = [
    JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: '{"results":[{"id":"a","actions":[],"explanation":"ok"}]}'
      }
    }),
    JSON.stringify({ type: 'turn.completed' })
  ].join('\n')
  assert.deepEqual(extractResponse('codex', output), {
    results: [{ id: 'a', actions: [], explanation: 'ok' }]
  })
  assert.throws(
    () => extractResponse('codex', output.replace('turn.completed', 'turn.failed')),
    /failed/
  )
})

void test('rejects malformed, unsuccessful, and reasoning-only output', () => {
  assert.throws(
    () =>
      extractResponse(
        'claude',
        JSON.stringify({ subtype: 'error', is_error: true, result: '{}' })
      ),
    /successful/
  )
  assert.throws(
    () =>
      extractResponse(
        'claude',
        JSON.stringify({ subtype: 'success', is_error: false, result: 'not json' })
      ),
    /valid JSON/
  )
  assert.throws(
    () =>
      extractResponse(
        'opencode',
        JSON.stringify({ type: 'text', part: { type: 'reasoning', text: '{}' } })
      ),
    /no final JSON/
  )
})

void test('uses a real subprocess, retains failed evidence, and refuses overwrite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evaluate-agent-test-'))
  const bin = join(root, 'bin')
  await mkdir(bin)
  const fake = join(bin, 'opencode')
  await writeFile(
    fake,
    "#!/bin/sh\nprintf 'trace\\n'\nprintf 'failure\\n%s\\n' \"$PWD\" >&2\nexit 7\n"
  )
  await chmod(fake, 0o755)
  const skill = join(root, 'skill.md')
  const cases = join(root, 'cases.json')
  const output = join(root, 'evidence')
  await writeFile(skill, 'skill')
  await writeFile(
    cases,
    JSON.stringify({
      instructions: 'return results',
      cases: [{ id: 'a', scenario: 'probe' }]
    })
  )
  const oldPath = process.env.PATH
  process.env.PATH = `${bin}:${oldPath ?? ''}`
  try {
    await assert.rejects(
      runEvaluation({
        host: 'opencode',
        model: 'm',
        skillPath: skill,
        outputDir: output,
        casesPath: cases,
        timeoutMs: 1000
      }),
      /status 7/
    )
    assert.equal(await readFile(join(output, 'stdout.jsonl'), 'utf8'), 'trace\n')
    const stderr = await readFile(join(output, 'stderr.log'), 'utf8')
    const temporaryCwd = stderr.trimEnd().split('\n').at(-1)
    assert.match(stderr, /^failure\n/)
    assert.ok(temporaryCwd)
    await assert.rejects(access(temporaryCwd))
    const metadataText = await readFile(join(output, 'metadata.json'), 'utf8')
    const metadata = JSON.parse(metadataText)
    assert.equal(metadata.outputLimitExceeded, false)
    await assert.rejects(
      runEvaluation({
        host: 'opencode',
        model: 'm',
        skillPath: skill,
        outputDir: output,
        casesPath: cases,
        timeoutMs: 1000
      }),
      /already exists/
    )
    assert.equal(await readFile(join(output, 'stdout.jsonl'), 'utf8'), 'trace\n')
    assert.equal(await readFile(join(output, 'stderr.log'), 'utf8'), stderr)
  } finally {
    if (oldPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = oldPath
    }
  }
})

void test('preserves spawn failure details', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evaluate-agent-spawn-'))
  const result = await captureCli({
    command: join(root, 'missing-cli'),
    args: [],
    input: '',
    cwd: root,
    timeoutMs: 1000
  })
  assert.notEqual(result.status, 0)
  assert.equal(result.outputLimitExceeded, false)
  assert.match(result.stderr, /ENOENT/)
})

void test('kills the whole process group on timeout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evaluate-agent-timeout-'))
  const childPidPath = join(root, 'child.pid')
  const result = await captureCli({
    command: '/bin/sh',
    // Reap the child before exiting so the assertion cannot race an orphaned zombie.
    args: [
      '-c',
      `trap 'wait "$child"; exit 0' TERM; sleep 30 & child=$!; echo "$child" > '${childPidPath}'; wait "$child"`
    ],
    input: '',
    cwd: root,
    timeoutMs: 100
  })
  assert.equal(result.timedOut, true)
  const childPidText = await readFile(childPidPath, 'utf8')
  const childPid = Number(childPidText.trim())
  assert.throws(() => process.kill(childPid, 0))
})

void test('kills output-heavy processes and never accepts their clipped prefix', async () => {
  const validPrefix = JSON.stringify({
    type: 'text',
    part: {
      type: 'text',
      text: '{"results":[{"id":"a","actions":[],"explanation":"ok"}]}'
    }
  })
  const result = await captureCli({
    command: '/bin/sh',
    args: ['-c', `printf '%s\\n' '${validPrefix}'; exec yes x`],
    input: '',
    cwd: process.cwd(),
    timeoutMs: 5000
  })
  assert.equal(result.outputLimitExceeded, true)
  assert.notEqual(result.status, 0)
})

void test('rejects duplicate fixture ids and missing response ids', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evaluate-agent-ids-'))
  const bin = join(root, 'bin')
  await mkdir(bin)
  const fake = join(bin, 'opencode')
  await writeFile(
    fake,
    `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ type: 'text', part: { type: 'text', text: '{"results":[{"id":"a","actions":[],"explanation":"ok"}]}' } })}'\n`
  )
  await chmod(fake, 0o755)
  const skill = join(root, 'skill.md')
  await writeFile(skill, 'skill')
  const oldPath = process.env.PATH
  process.env.PATH = `${bin}:${oldPath ?? ''}`
  try {
    const fixtures = [
      {
        name: 'duplicates',
        fixture: {
          instructions: 'return results',
          cases: [
            { id: 'a', scenario: 'one' },
            { id: 'a', scenario: 'two' }
          ]
        }
      },
      {
        name: 'missing',
        fixture: {
          instructions: 'return results',
          cases: [
            { id: 'a', scenario: 'one' },
            { id: 'b', scenario: 'two' }
          ]
        }
      }
    ]
    for (const { name, fixture } of fixtures) {
      const cases = join(root, `${name}.json`)
      await writeFile(cases, JSON.stringify(fixture))
      await assert.rejects(
        runEvaluation({
          host: 'opencode',
          model: 'm',
          skillPath: skill,
          outputDir: join(root, name),
          casesPath: cases,
          timeoutMs: 1000
        }),
        /parsed/
      )
    }
  } finally {
    if (oldPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = oldPath
    }
  }
})
