import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { requiredEnv } from '../../scripts/internal/env.ts'

type CommandResult = { readonly stdout: string; readonly stderr: string }
type CommandRunner = (
  args: ReadonlyArray<string>,
  input?: string
) => Promise<CommandResult>
const execGh = promisify(execFile)

function runGh(args: ReadonlyArray<string>, input?: string): Promise<CommandResult> {
  if (input === undefined) {
    return execGh('gh', args, { encoding: 'utf8' })
  }
  return (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'preview-status-'))
    const inputPath = join(directory, 'request.json')
    await writeFile(inputPath, input)
    try {
      const resolvedArgs = args.map((arg) => (arg === '-' ? inputPath : arg))
      return await execGh('gh', resolvedArgs, { encoding: 'utf8' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })()
}

function deploymentBase(env: NodeJS.ProcessEnv): string {
  return `repos/${requiredEnv(env, 'GITHUB_REPOSITORY')}/deployments`
}

export function previewSummary(env: NodeJS.ProcessEnv): string {
  const stage = requiredEnv(env, 'ALCHEMY_STAGE')
  const commit = requiredEnv(env, 'GIT_COMMIT_SHA')
  const webUrl = requiredEnv(env, 'WEB_URL')
  const apiUrl = requiredEnv(env, 'API_URL')
  const backgroundUrl = requiredEnv(env, 'BACKGROUND_URL')
  return [
    `### Preview stage \`${stage}\``,
    '',
    '| Worker | URL |',
    '| --- | --- |',
    `| web | ${webUrl} |`,
    `| api | ${apiUrl}/health |`,
    `| background | ${backgroundUrl} |`,
    '',
    `Deployed \`${commit}\`. The stage has its own D1 seeded with the Seed Workspace (\`starter-lab\`; demo sign-in in \`docs/setup.md\`). Env-gated providers (Turnstile, Stripe, Sentry, PostHog, email, AI) are off. The stage is destroyed when this PR closes.`,
    ''
  ].join('\n')
}

async function reportDeployed(
  env: NodeJS.ProcessEnv,
  run: CommandRunner
): Promise<void> {
  const base = deploymentBase(env)
  const stage = requiredEnv(env, 'ALCHEMY_STAGE')
  const commit = requiredEnv(env, 'GIT_COMMIT_SHA')
  const server = requiredEnv(env, 'GITHUB_SERVER_URL')
  const repository = requiredEnv(env, 'GITHUB_REPOSITORY')
  requiredEnv(env, 'GH_TOKEN')
  const webUrl = requiredEnv(env, 'WEB_URL')
  const payload = JSON.stringify({
    ref: commit,
    environment: stage,
    transient_environment: true,
    production_environment: false,
    auto_merge: false,
    required_contexts: []
  })
  const deployment = await run(
    ['api', '--method', 'POST', base, '--input', '-', '--jq', '.id'],
    payload
  )
  const deploymentId = deployment.stdout.trim()
  if (!deploymentId) {
    throw new Error('GitHub returned no deployment id')
  }
  await run([
    'api',
    '--method',
    'POST',
    `${base}/${deploymentId}/statuses`,
    '-f',
    'state=success',
    '-f',
    `environment_url=${webUrl}`,
    '-f',
    `log_url=${server}/${repository}/actions/runs/${requiredEnv(env, 'GITHUB_RUN_ID')}`,
    '-f',
    'description=Preview stage deployed'
  ])
  const summaryPath = env.GITHUB_STEP_SUMMARY
  if (summaryPath) {
    await appendFile(summaryPath, previewSummary(env))
  }
  console.log(`Marked deployment ${deploymentId} (${stage}) as success`)
}

async function reportDestroyed(
  env: NodeJS.ProcessEnv,
  run: CommandRunner
): Promise<void> {
  const base = deploymentBase(env)
  const stage = requiredEnv(env, 'ALCHEMY_STAGE')
  requiredEnv(env, 'GH_TOKEN')
  const result = await run([
    'api',
    '--paginate',
    `${base}?environment=${stage}`,
    '--jq',
    '.[].id'
  ])
  const deploymentIds = result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
  for (const deploymentId of deploymentIds) {
    // oxlint-disable-next-line no-await-in-loop -- Preserve sequential API writes and avoid rate-limit bursts on long-lived PRs.
    await run([
      'api',
      '--method',
      'POST',
      `${base}/${deploymentId}/statuses`,
      '-f',
      'state=inactive',
      '-f',
      'description=Stage destroyed'
    ])
    console.log(`Marked deployment ${deploymentId} (${stage}) as inactive`)
  }
}

export async function main(
  args: ReadonlyArray<string> = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  run: CommandRunner = runGh
): Promise<void> {
  const mode = args[0]
  if (args.length !== 1 || (mode !== 'deployed' && mode !== 'destroyed')) {
    console.error('usage: preview-status.ts <deployed|destroyed>')
    process.exitCode = 64
    return
  }
  if (mode === 'deployed') {
    await reportDeployed(env, run)
  } else {
    await reportDestroyed(env, run)
  }
}

if (process.argv[1] === import.meta.filename) {
  main().catch(() => {
    console.error('preview status reporting failed')
    process.exitCode = 1
  })
}
