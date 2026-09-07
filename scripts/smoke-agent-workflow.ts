import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Schema } from 'effect'
import { captureCli } from './evaluate-agent-workflow.ts'

const Options = Schema.Struct({
  host: Schema.Literals(['codex', 'claude', 'opencode']),
  model: Schema.NonEmptyString,
  worker: Schema.NonEmptyString,
  skill: Schema.NonEmptyString,
  output: Schema.NonEmptyString
})
const decodeOptions = Schema.decodeUnknownSync(Options)

async function main() {
  const { values } = parseArgs({
    options: {
      host: { type: 'string' },
      model: { type: 'string' },
      worker: { type: 'string' },
      skill: { type: 'string' },
      output: { type: 'string' }
    }
  })
  const options = decodeOptions(values)
  const skill = await readFile(resolve(options.skill), 'utf8')
  const output = resolve(options.output)
  await mkdir(dirname(output), { recursive: true })
  await mkdir(output)
  const cwd = await mkdtemp(join(tmpdir(), 'workflow-native-'))
  const nonce = randomUUID()
  const fixture = join(cwd, 'fixture.txt')
  const prompt = `${skill}

NARROW NATIVE DELEGATION SMOKE TEST
Coordinator model: ${options.model}. Configured worker model: ${options.worker}.
For OpenCode, the configured bounded-worker profile selects that worker model.
Explicitly delegate ONE fresh read-only task despite its small size: have the worker
read ${fixture} and return its exact contents. Do not read the fixture yourself.
Pass only the path and task, not parent conversation history. Stop after the worker
returns the value. No reviews, further workers, commits, push, browser, or unrelated
files are in scope. Use existing permissions. Report the returned value and dispatch
arguments; if unavailable, report the failure without pretending to delegate.
`
  try {
    const version = await captureCli({
      command: options.host,
      args: ['--version'],
      input: '',
      cwd,
      timeoutMs: 5000
    })
    await writeFile(fixture, nonce)
    await writeFile(join(output, 'expected.txt'), nonce)
    await writeFile(join(output, 'prompt.txt'), prompt)
    if (options.host === 'opencode') {
      await writeFile(
        join(cwd, 'opencode.json'),
        JSON.stringify({
          $schema: 'https://opencode.ai/config.json',
          agent: {
            'bounded-worker': {
              description: 'Bounded read-only fixture tasks',
              mode: 'subagent',
              model: options.worker,
              permission: { edit: 'deny', bash: 'deny', task: 'deny' }
            }
          },
          permission: { edit: 'deny', bash: 'deny', read: 'allow', task: 'allow' }
        })
      )
    }
    const args = {
      codex: [
        'exec',
        '--ignore-user-config',
        '--model',
        options.model,
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '--ephemeral',
        '--json',
        '-'
      ],
      claude: [
        '-p',
        '--model',
        options.model,
        '--tools',
        'Agent,Read',
        '--allowedTools',
        'Agent,Read',
        '--permission-mode',
        'dontAsk',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--output-format',
        'stream-json',
        '--verbose',
        '--forward-subagent-text'
      ],
      opencode: ['run', '--pure', '--model', options.model, '--format', 'json', prompt]
    }[options.host]
    const started = Date.now()
    const result = await captureCli({
      command: options.host,
      args,
      input: options.host === 'opencode' ? '' : prompt,
      cwd,
      timeoutMs: 120_000
    })
    await writeFile(join(output, 'stdout.jsonl'), result.stdout)
    await writeFile(join(output, 'stderr.log'), result.stderr)
    await writeFile(
      join(output, 'metadata.json'),
      `${JSON.stringify(
        {
          host: options.host,
          model: options.model,
          worker: options.worker,
          cliVersion: version.stdout.trim() || 'unavailable',
          skillSha256: createHash('sha256').update(skill).digest('hex'),
          durationMs: Date.now() - started,
          exitStatus: result.status,
          timedOut: result.timedOut,
          outputLimitExceeded: result.outputLimitExceeded,
          verdict: 'requires trace inspection; process success alone is not a pass'
        },
        null,
        2
      )}\n`
    )
    if (result.status !== 0 || result.timedOut || result.outputLimitExceeded) {
      throw new Error('Native smoke process failed; inspect retained evidence')
    }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

if (process.argv[1] === import.meta.filename) {
  await main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
