// Failure modes recorded before implementation:
// - A repeat apply writes unchanged settings, or drift in one endpoint rewrites all.
// - Permission errors become a missing resource or an apparently successful apply.
// - A partial apply failure is hidden, preventing a later retry from converging.
// - Destroy resets existing repository policy or changes the wrong repository.
import { createServer } from 'node:http'
import { once } from 'node:events'
import * as GitHub from '@alchemy.run/github'
import { Effect } from 'effect'
import { expect, it, onTestFinished } from 'vite-plus/test'
import { reconcileGitHubControls } from '../infra/github-controls.ts'

const desired = {
  owner: 'owner',
  repository: 'repo',
  actions: { enabled: true, allowed_actions: 'all', sha_pinning_required: false },
  workflow: {
    default_workflow_permissions: 'write',
    can_approve_pull_request_reviews: true
  },
  retention: { days: 90 },
  forks: { approval_policy: 'first_time_contributors' },
  repositoryPolicy: {
    allow_update_branch: false,
    allow_forking: true,
    web_commit_signoff_required: false,
    squash_merge_commit_title: 'PR_TITLE',
    squash_merge_commit_message: 'PR_BODY',
    security_and_analysis: {
      secret_scanning: { status: 'disabled' },
      secret_scanning_push_protection: { status: 'disabled' }
    }
  }
} as const

async function fixture(failPath?: string) {
  let failWrite: string | undefined
  const state = new Map<string, object>([
    ['', desired.repositoryPolicy],
    ['/actions/permissions', desired.actions],
    ['/actions/permissions/workflow', desired.workflow],
    ['/actions/permissions/artifact-and-log-retention', desired.retention],
    ['/actions/permissions/fork-pr-contributor-approval', desired.forks]
  ])
  const writes: Array<string> = []
  const server = createServer((request, response) => {
    const path = request.url?.replace('/api/v3/repos/owner/repo', '') ?? ''
    response.setHeader('content-type', 'application/json')
    if (
      !state.has(path) ||
      path === failPath ||
      (request.method !== 'GET' && path === failWrite)
    ) {
      response.writeHead(403).end(JSON.stringify({ message: 'Forbidden' }))
      return
    }
    if (request.method === 'PUT' || request.method === 'PATCH') {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        state.set(path, JSON.parse(body))
        writes.push(path)
        response.writeHead(204).end()
      })
    } else {
      response.end(JSON.stringify(state.get(path)))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(() => {
    server.close()
    server.closeAllConnections()
  })
  const address = server.address()
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Node's server address is a Unix socket string or TCP address, not domain input.
  if (!address || typeof address === 'string') {
    throw new Error('No local address')
  }
  const credentials = GitHub.fromToken('test-token', {
    baseUrl: `http://127.0.0.1:${address.port}/api/v3`
  })
  return {
    state,
    writes,
    failWrites: (path: string | undefined) => {
      failWrite = path
    },
    run: () => {
      // oxlint-disable-next-line starter/no-run-promise-in-tests -- Exercises the real Octokit adapter against a local HTTP fixture.
      return Effect.runPromise(
        reconcileGitHubControls(desired).pipe(Effect.provide(credentials))
      )
    }
  }
}

it('reads current policy and changes only drifted endpoints, then converges', async () => {
  const test = await fixture()
  await test.run()
  expect(test.writes).toEqual([])
  test.state.set('/actions/permissions/workflow', {
    default_workflow_permissions: 'read',
    can_approve_pull_request_reviews: false
  })
  await test.run()
  expect(test.writes).toEqual(['/actions/permissions/workflow'])
  await test.run()
  expect(test.writes).toHaveLength(1)
})

it('propagates permission failures without writing other settings', async () => {
  const test = await fixture('/actions/permissions/workflow')
  await expect(test.run()).rejects.toMatchObject({
    _tag: 'GitHubControlsError',
    operation: 'read workflow permissions'
  })
  expect(test.writes).toEqual([])
})

it('retries a partial apply without repeating the completed repository update', async () => {
  const test = await fixture()
  test.state.set('', { ...desired.repositoryPolicy, allow_update_branch: true })
  test.state.set('/actions/permissions/workflow', {
    default_workflow_permissions: 'read',
    can_approve_pull_request_reviews: false
  })
  test.failWrites('/actions/permissions/workflow')
  await expect(test.run()).rejects.toMatchObject({
    _tag: 'GitHubControlsError',
    operation: 'write workflow permissions'
  })
  expect(test.writes).toEqual([''])
  test.failWrites(undefined)
  await test.run()
  expect(test.writes).toEqual(['', '/actions/permissions/workflow'])
  await test.run()
  expect(test.writes).toHaveLength(2)
})
