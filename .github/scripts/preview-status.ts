import { appendFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

import { requiredEnv } from '../../scripts/lib/env.ts'

// The real runner is synchronous; the test double is not, so callers await it.
type CommandRunner = (
  args: ReadonlyArray<string>,
  input?: string
) => string | Promise<string>

function runGh(args: ReadonlyArray<string>, input?: string): string {
  // `gh api --input -` reads the request body from stdin.
  return execFileSync('gh', [...args], { encoding: 'utf8', input })
}

function deploymentBase(env: NodeJS.ProcessEnv): string {
  return `repos/${requiredEnv('GITHUB_REPOSITORY', env)}/deployments`
}

export function previewSummary(env: NodeJS.ProcessEnv): string {
  const stage = requiredEnv('ALCHEMY_STAGE', env)
  const commit = requiredEnv('GIT_COMMIT_SHA', env)
  const webUrl = requiredEnv('WEB_URL', env)
  const apiUrl = requiredEnv('API_URL', env)
  const backgroundUrl = requiredEnv('BACKGROUND_URL', env)
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
  const stage = requiredEnv('ALCHEMY_STAGE', env)
  const commit = requiredEnv('GIT_COMMIT_SHA', env)
  const server = requiredEnv('GITHUB_SERVER_URL', env)
  const repository = requiredEnv('GITHUB_REPOSITORY', env)
  requiredEnv('GH_TOKEN', env)
  const webUrl = requiredEnv('WEB_URL', env)
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
  const deploymentId = deployment.trim()
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
    `log_url=${server}/${repository}/actions/runs/${requiredEnv('GITHUB_RUN_ID', env)}`,
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
  const stage = requiredEnv('ALCHEMY_STAGE', env)
  requiredEnv('GH_TOKEN', env)
  const result = await run([
    'api',
    '--paginate',
    `${base}?environment=${stage}`,
    '--jq',
    '.[].id'
  ])
  const deploymentIds = result
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

if (import.meta.main) {
  main().catch(() => {
    console.error('preview status reporting failed')
    process.exitCode = 1
  })
}
