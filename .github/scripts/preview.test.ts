import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { test } from 'vite-plus/test'
import { main as urlsMain, resolveSubdomain, stageEnv } from './preview-urls.ts'
import { main as statusMain, previewSummary } from './preview-status.ts'

test('preview URL resolution validates Cloudflare response and formats worker URLs', async () => {
  const calls: Array<{ readonly url: string; readonly authorization: string }> = []
  const subdomain = await resolveSubdomain('account', 'secret', async (url, init) => {
    calls.push({
      url,
      authorization: new Headers(init?.headers).get('authorization') ?? ''
    })
    return new Response(JSON.stringify({ result: { subdomain: 'example' } }), {
      status: 200
    })
  })
  assert.equal(subdomain, 'example')
  assert.deepEqual(calls, [
    {
      url: 'https://api.cloudflare.com/client/v4/accounts/account/workers/subdomain',
      authorization: 'Bearer secret'
    }
  ])
  assert.equal(
    stageEnv('example', 'pr-1'),
    [
      'CLOUDFLARE_WORKERS_SUBDOMAIN=example',
      'WEB_URL=https://b2b-saas-starter-pr-1-web.example.workers.dev',
      'API_URL=https://b2b-saas-starter-pr-1-api.example.workers.dev',
      'BACKGROUND_URL=https://b2b-saas-starter-pr-1-background.example.workers.dev'
    ].join('\n')
  )
})

test('preview URL command writes GITHUB_ENV without echoing the token', async () => {
  let output = ''
  await urlsMain(
    {
      ALCHEMY_STAGE: 'pr-2',
      CLOUDFLARE_ACCOUNT_ID: 'account',
      CLOUDFLARE_API_TOKEN: 'secret'
    },
    async () => new Response(JSON.stringify({ result: { subdomain: 'example' } })),
    async (value) => {
      output = value
    }
  )
  assert.match(
    output,
    /WEB_URL=https:\/\/b2b-saas-starter-pr-2-web\.example\.workers\.dev/
  )
  assert.doesNotMatch(output, /secret/)
})

test('deployed status creates a transient deployment, marks it success, and writes the summary', async () => {
  const commands: Array<{
    readonly args: ReadonlyArray<string>
    readonly input: string | undefined
  }> = []
  const directory = await mkdtemp(join(tmpdir(), 'preview-test-'))
  const summaryPath = join(directory, 'summary.md')
  const env = {
    ALCHEMY_STAGE: 'pr-3',
    GIT_COMMIT_SHA: 'abc',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_RUN_ID: '42',
    GH_TOKEN: 'secret',
    WEB_URL: 'https://web.example',
    API_URL: 'https://api.example',
    BACKGROUND_URL: 'https://bg.example',
    GITHUB_STEP_SUMMARY: summaryPath
  }
  await statusMain(['deployed'], env, async (args, input) => {
    commands.push({ args, input })
    return commands.length === 1 ? '123\n' : ''
  })
  assert.deepEqual(
    commands.map(({ args }) => args),
    [
      [
        'api',
        '--method',
        'POST',
        'repos/owner/repo/deployments',
        '--input',
        '-',
        '--jq',
        '.id'
      ],
      [
        'api',
        '--method',
        'POST',
        'repos/owner/repo/deployments/123/statuses',
        '-f',
        'state=success',
        '-f',
        'environment_url=https://web.example',
        '-f',
        'log_url=https://github.com/owner/repo/actions/runs/42',
        '-f',
        'description=Preview stage deployed'
      ]
    ]
  )
  assert.match(commands[0]?.input ?? '', /"ref":"abc"/)
  assert.equal(await readFile(summaryPath, 'utf8'), previewSummary(env))
})

test('destroyed status paginates deployments and marks every id inactive', async () => {
  const seen: Array<ReadonlyArray<string>> = []
  let pending = false
  await statusMain(
    ['destroyed'],
    { ALCHEMY_STAGE: 'pr-4', GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'secret' },
    async (args) => {
      assert.equal(pending, false, 'Deployment writes must be sequential')
      pending = true
      await setTimeout(0)
      pending = false
      seen.push(args)
      return seen.length === 1 ? '1\n2\n' : ''
    }
  )
  assert.deepEqual(seen, [
    [
      'api',
      '--paginate',
      'repos/owner/repo/deployments?environment=pr-4',
      '--jq',
      '.[].id'
    ],
    [
      'api',
      '--method',
      'POST',
      'repos/owner/repo/deployments/1/statuses',
      '-f',
      'state=inactive',
      '-f',
      'description=Stage destroyed'
    ],
    [
      'api',
      '--method',
      'POST',
      'repos/owner/repo/deployments/2/statuses',
      '-f',
      'state=inactive',
      '-f',
      'description=Stage destroyed'
    ]
  ])
})
