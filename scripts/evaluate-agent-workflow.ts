import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { Schema } from 'effect'

export type Host = 'codex' | 'claude' | 'opencode'
type Case = { readonly id: string; readonly scenario: string }
type Fixture = { readonly instructions: string; readonly cases: ReadonlyArray<Case> }
const InvocationSchema = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
  stdin: Schema.Boolean
})
type Invocation = Schema.Schema.Type<typeof InvocationSchema>
type ProcessResult = {
  stdout: string
  stderr: string
  status: number | null
  timedOut: boolean
  outputLimitExceeded: boolean
}
const OUTPUT_LIMIT = 8 * 1024 * 1024
const ResponseSchema = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      actions: Schema.Array(Schema.Unknown),
      explanation: Schema.String
    })
  )
})
type Response = Schema.Schema.Type<typeof ResponseSchema>
const FixtureSchema = Schema.Struct({
  instructions: Schema.String,
  cases: Schema.Array(Schema.Struct({ id: Schema.String, scenario: Schema.String }))
})
const decodeResponse = Schema.decodeUnknownSync(ResponseSchema)
const decodeFixture = Schema.decodeUnknownSync(FixtureSchema)
const CodexEvent = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  item: Schema.optionalKey(
    Schema.Struct({
      type: Schema.optionalKey(Schema.String),
      text: Schema.optionalKey(Schema.String)
    })
  )
})
const OpenCodeEvent = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  part: Schema.optionalKey(
    Schema.Struct({
      type: Schema.optionalKey(Schema.String),
      text: Schema.optionalKey(Schema.String)
    })
  )
})
const decodeCodexEvent = Schema.decodeUnknownSync(CodexEvent)
const decodeOpenCodeEvent = Schema.decodeUnknownSync(OpenCodeEvent)
const decodeString = Schema.decodeUnknownSync(Schema.String)
const ClaudeEnvelope = Schema.Struct({
  result: Schema.optionalKey(Schema.String),
  structured_output: Schema.optionalKey(Schema.Unknown),
  is_error: Schema.optionalKey(Schema.Boolean),
  subtype: Schema.optionalKey(Schema.String)
})
const decodeClaudeEnvelope = Schema.decodeUnknownSync(ClaudeEnvelope)
const decodeHost = Schema.decodeUnknownSync(
  Schema.Literals(['codex', 'claude', 'opencode'])
)
const FileSystemError = Schema.Struct({ code: Schema.String })
const isFileSystemError = Schema.is(FileSystemError)
const decodeProcessError = Schema.decodeUnknownSync(
  Schema.Struct({ message: Schema.String })
)
export function invocation(host: Host, model: string): Invocation {
  if (host === 'codex') {
    return {
      command: 'codex',
      args: [
        'exec',
        '--model',
        model,
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '--ephemeral',
        '--ignore-user-config',
        '--json',
        '-'
      ],
      stdin: true
    }
  }
  if (host === 'claude') {
    return {
      command: 'claude',
      args: [
        '-p',
        '--model',
        model,
        '--tools',
        '',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--output-format',
        'json'
      ],
      stdin: true
    }
  }
  return {
    command: 'opencode',
    args: ['run', '--pure', '--model', model, '--format', 'json'],
    stdin: false
  }
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function promptFor(skill: string, fixture: Fixture): string {
  return [
    'You are evaluating an agent workflow. Follow the supplied skill text and answer every case.',
    'Follow the fixture instructions exactly and return its requested JSON shape. Do not claim tools, delegation, or external verification that did not occur.',
    '\n=== SKILL TEXT ===\n',
    skill,
    '\n=== EVALUATION INSTRUCTIONS ===\n',
    fixture.instructions,
    '\n=== CASES ===\n',
    JSON.stringify(fixture.cases, null, 2)
  ].join('')
}

function jsonText(text: string): Response {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  if (!trimmed) {
    throw new Error('model produced no final JSON text')
  }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return decodeResponse(parsed)
  } catch {
    throw new Error('model final output was not valid JSON')
  }
}

export function extractResponse(host: Host, stdout: string): Response {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (host === 'claude') {
    const envelope = decodeClaudeEnvelope(JSON.parse(stdout))
    if (envelope.is_error !== false || envelope.subtype !== 'success') {
      throw new Error('Claude result was not a successful response')
    }
    if (envelope.structured_output !== undefined) {
      return decodeResponse(envelope.structured_output)
    }
    if (envelope.result === undefined) {
      throw new Error('Claude output had no result text')
    }
    return jsonText(envelope.result)
  }
  if (host === 'codex') {
    let completed = false
    let failed = false
    let message: string | undefined
    for (const line of lines) {
      try {
        const event = decodeCodexEvent(JSON.parse(line))
        if (event.type === 'turn.completed') {
          completed = true
        }
        if (event.type === 'turn.failed') {
          failed = true
        }
        if (
          event.type === 'item.completed' &&
          event.item?.type === 'agent_message' &&
          event.item.text
        ) {
          message = event.item.text
        }
      } catch {
        continue
      }
    }
    if (failed) {
      throw new Error('Codex turn failed')
    }
    if (!completed) {
      throw new Error('Codex output had no completed turn')
    }
    if (message) {
      return jsonText(message)
    }
    throw new Error('Codex output had no completed agent message')
  }
  let text = ''
  for (const line of lines) {
    try {
      const event = decodeOpenCodeEvent(JSON.parse(line))
      if (event.type === 'text' && event.part?.type === 'text' && event.part.text) {
        text += event.part.text
      }
    } catch {
      continue
    }
  }
  return jsonText(text)
}

function validateResponse(value: unknown, cases: ReadonlyArray<Case>): Response {
  const response = decodeResponse(value)
  if (response.results.length === 0) {
    throw new TypeError('model response must contain a non-empty results array')
  }
  const expected = new Set(cases.map((item) => item.id))
  if (expected.size !== cases.length) {
    throw new Error('fixture case ids must be unique')
  }
  const seen = new Set<string>()
  for (const item of response.results) {
    if (!expected.has(item.id) || seen.has(item.id)) {
      throw new Error('results must contain each expected case id exactly once')
    }
    seen.add(item.id)
  }
  if (seen.size !== expected.size) {
    throw new Error('results must contain each expected case id exactly once')
  }
  return response
}

async function runProcess(
  command: string,
  args: Array<string>,
  input: string,
  useStdin: boolean,
  cwd: string,
  timeoutMs: number
) {
  // oxlint-disable-next-line effect/noNewPromise -- Node child-process events require a Promise bridge.
  return new Promise<ProcessResult>((_resolve) => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let outputLimitExceeded = false
    let terminating = false
    let forceKillTimer: NodeJS.Timeout | undefined

    function signalTree(signal: NodeJS.Signals) {
      if (process.platform === 'win32') {
        if (child.pid !== undefined) {
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            stdio: 'ignore',
            windowsHide: true
          }).unref()
        }
        return
      }
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal)
        } catch {
          child.kill(signal)
        }
      }
    }

    function terminate() {
      if (terminating) {
        return
      }
      terminating = true
      signalTree('SIGTERM')
      forceKillTimer = setTimeout(() => signalTree('SIGKILL'), 2000)
      forceKillTimer.unref()
    }

    function append(current: string, chunk: string) {
      const remaining = OUTPUT_LIMIT - current.length
      if (remaining <= 0) {
        outputLimitExceeded = true
        terminate()
        return current
      }
      if (chunk.length > remaining) {
        outputLimitExceeded = true
        terminate()
      }
      return current + chunk.slice(0, remaining)
    }
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr = append(stderr, chunk)
    })
    const timeoutTimer = setTimeout(() => {
      timedOut = true
      terminate()
    }, timeoutMs)
    child.on('error', (error) => {
      const failure = decodeProcessError(error)
      stderr = append(stderr, `${failure.message}\n`)
    })
    child.on('close', (status) => {
      if (terminating) {
        signalTree('SIGKILL')
      }
      clearTimeout(timeoutTimer)
      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer)
      }
      _resolve({ stdout, stderr, status, timedOut, outputLimitExceeded })
    })
    child.stdin.on('error', (error) => {
      const failure = decodeProcessError(error)
      stderr = append(stderr, `${failure.message}\n`)
    })
    child.stdin.end(useStdin ? input : undefined)
  })
}

export function captureCli(options: {
  command: string
  args: Array<string>
  input: string
  cwd: string
  timeoutMs: number
}) {
  return runProcess(
    options.command,
    options.args,
    options.input,
    options.input.length > 0,
    options.cwd,
    options.timeoutMs
  )
}

export async function runEvaluation(options: {
  host: Host
  model: string
  skillPath: string
  outputDir: string
  casesPath: string
  timeoutMs: number
}) {
  const outputDir = resolve(options.outputDir)
  await mkdir(dirname(outputDir), { recursive: true })
  try {
    await mkdir(outputDir)
  } catch (error) {
    if (isFileSystemError(error) && error.code === 'EEXIST') {
      throw new Error(`output directory already exists: ${outputDir}`, {
        cause: error
      })
    }
    throw error
  }
  const skill = await readFile(resolve(options.skillPath), 'utf8')
  const fixtureText = await readFile(resolve(options.casesPath), 'utf8')
  const fixture = decodeFixture(JSON.parse(fixtureText))
  const prompt = promptFor(skill, fixture)
  await writeFile(join(outputDir, 'prompt.txt'), prompt)
  const tempCwd = await mkdtemp(join(tmpdir(), 'agent-workflow-'))
  try {
    const cmd = invocation(options.host, options.model)
    const version = spawnSync(cmd.command, ['--version'], {
      cwd: tempCwd,
      shell: false,
      encoding: 'utf8',
      timeout: 5000
    })
    const cliVersion = (version.stdout || version.stderr || '').trim() || 'unavailable'
    const started = Date.now()
    const result = await runProcess(
      cmd.command,
      cmd.stdin ? [...cmd.args] : [...cmd.args, prompt],
      cmd.stdin ? prompt : '',
      cmd.stdin,
      tempCwd,
      options.timeoutMs
    )
    await writeFile(join(outputDir, 'stdout.jsonl'), result.stdout)
    await writeFile(join(outputDir, 'stderr.log'), result.stderr)
    let parseError: string | undefined
    if (result.status === 0 && !result.timedOut && !result.outputLimitExceeded) {
      try {
        await writeFile(
          join(outputDir, 'response.json'),
          `${JSON.stringify(
            validateResponse(
              extractResponse(options.host, result.stdout),
              fixture.cases
            ),
            null,
            2
          )}\n`
        )
      } catch {
        parseError = 'model output could not be parsed'
      }
    }
    const metadata = {
      host: options.host,
      model: options.model,
      skillSha256: hash(skill),
      fixtureSha256: hash(fixtureText),
      exitStatus: result.status,
      timedOut: result.timedOut,
      outputLimitExceeded: result.outputLimitExceeded,
      durationMs: Date.now() - started,
      cliVersion,
      parseError
    }
    await writeFile(
      join(outputDir, 'metadata.json'),
      `${JSON.stringify(metadata, null, 2)}\n`
    )
    if (
      result.status !== 0 ||
      result.timedOut ||
      result.outputLimitExceeded ||
      parseError
    ) {
      let failure = `CLI exited with status ${result.status}`
      if (result.timedOut) {
        failure = 'CLI timed out'
      }
      if (result.outputLimitExceeded) {
        failure = 'CLI output limit exceeded'
      }
      throw new Error(parseError ?? failure)
    }
    return metadata
  } finally {
    await rm(tempCwd, { recursive: true, force: true })
  }
}

export function parseCli(raw: ReadonlyArray<string>) {
  const parsed = parseArgs({
    args: raw,
    options: {
      host: { type: 'string' },
      model: { type: 'string' },
      skill: { type: 'string' },
      output: { type: 'string' },
      cases: { type: 'string' },
      'timeout-ms': { type: 'string' }
    }
  })
  // SAFETY: parseArgs returns strings for the declared string option; the schema validates the allowed host literal.
  const host = decodeHost(parsed.values.host)
  if (!['codex', 'claude', 'opencode'].includes(host)) {
    throw new Error('--host must be codex, claude, or opencode')
  }
  const model = decodeString(parsed.values.model)
  if (!model) {
    throw new Error('--model is required')
  }
  const skillPath = decodeString(parsed.values.skill)
  const outputDir = decodeString(parsed.values.output)
  const timeoutMs = Number(parsed.values['timeout-ms'] ?? 120_000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('--timeout-ms must be a positive integer')
  }
  return {
    host,
    model,
    skillPath,
    outputDir,
    casesPath: parsed.values.cases ?? 'docs/agents/evals/workflow-cases.json',
    timeoutMs
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
  runEvaluation(parseCli(process.argv.slice(2))).catch(() => {
    console.error('agent workflow evaluation failed')
    process.exitCode = 1
  })
}
