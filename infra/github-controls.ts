import { Octokit } from '@alchemy.run/github/Octokit'
import { isResolved } from 'alchemy/Diff'
import * as Provider from 'alchemy/Provider'
import { Resource } from 'alchemy/Resource'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { isDeepStrictEqual } from 'node:util'

/** GitHub settings without native Alchemy resources. Field names match REST. */
export type GitHubControlsProps = {
  owner: string
  repository: string
  actions: {
    enabled: boolean
    allowed_actions: 'all' | 'local_only'
    sha_pinning_required: boolean
  }
  workflow: {
    default_workflow_permissions: 'read' | 'write'
    can_approve_pull_request_reviews: boolean
  }
  retention: { days: number }
  forks: {
    approval_policy:
      | 'first_time_contributors_new_to_github'
      | 'first_time_contributors'
      | 'all_external_contributors'
  }
  repositoryPolicy: {
    allow_update_branch: boolean
    allow_forking: boolean
    web_commit_signoff_required: boolean
    squash_merge_commit_title: 'PR_TITLE' | 'COMMIT_OR_PR_TITLE'
    squash_merge_commit_message: 'PR_BODY' | 'COMMIT_MESSAGES' | 'BLANK'
    security_and_analysis: {
      secret_scanning: { status: 'enabled' | 'disabled' }
      secret_scanning_push_protection: { status: 'enabled' | 'disabled' }
    }
  }
}

// oxlint-disable-next-line unicorn/throw-new-error -- TaggedError is Effect's error-class factory.
class GitHubControlsError extends Schema.TaggedError<GitHubControlsError>()(
  'GitHubControlsError',
  { operation: Schema.String, cause: Schema.Unknown }
) {}

function request<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new GitHubControlsError({ operation, cause })
  })
}

export const readGitHubControls = Effect.fn('GitHubControls.read')(function* (
  props: Pick<GitHubControlsProps, 'owner' | 'repository'>
) {
  const client = yield* Octokit
  const target = { owner: props.owner, repo: props.repository }
  const [actions, workflow, retention, forks, repo] = yield* Effect.all(
    [
      request('read Actions permissions', () =>
        client.rest.actions.getGithubActionsPermissionsRepository(target)
      ),
      request('read workflow permissions', () =>
        client.rest.actions.getGithubActionsDefaultWorkflowPermissionsRepository(target)
      ),
      request('read retention', () =>
        client.request(
          'GET /repos/{owner}/{repo}/actions/permissions/artifact-and-log-retention',
          target
        )
      ),
      request('read fork approvals', () =>
        client.request(
          'GET /repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval',
          target
        )
      ),
      request('read repository controls', () => client.rest.repos.get(target))
    ],
    { concurrency: 4 }
  )
  return {
    owner: props.owner,
    repository: props.repository,
    actions: {
      enabled: actions.data.enabled,
      allowed_actions: actions.data.allowed_actions,
      sha_pinning_required: actions.data.sha_pinning_required
    },
    workflow: workflow.data,
    retention: { days: retention.data.days },
    forks: { approval_policy: forks.data.approval_policy },
    repositoryPolicy: {
      allow_update_branch: repo.data.allow_update_branch,
      allow_forking: repo.data.allow_forking,
      web_commit_signoff_required: repo.data.web_commit_signoff_required,
      squash_merge_commit_title: repo.data.squash_merge_commit_title,
      squash_merge_commit_message: repo.data.squash_merge_commit_message,
      security_and_analysis: {
        secret_scanning: repo.data.security_and_analysis?.secret_scanning,
        secret_scanning_push_protection:
          repo.data.security_and_analysis?.secret_scanning_push_protection
      }
    }
  }
})

export const reconcileGitHubControls = Effect.fn('GitHubControls.reconcile')(function* (
  props: GitHubControlsProps
) {
  const client = yield* Octokit
  const target = { owner: props.owner, repo: props.repository }
  const current = yield* readGitHubControls(props)
  if (!isDeepStrictEqual(current.repositoryPolicy, props.repositoryPolicy)) {
    yield* request('write repository controls', () =>
      client.rest.repos.update({ ...target, ...props.repositoryPolicy })
    )
  }
  if (
    current.actions.enabled !== props.actions.enabled ||
    current.actions.allowed_actions !== props.actions.allowed_actions ||
    current.actions.sha_pinning_required !== props.actions.sha_pinning_required
  ) {
    yield* request('write Actions permissions', () =>
      client.rest.actions.setGithubActionsPermissionsRepository({
        ...target,
        ...props.actions
      })
    )
  }
  if (
    current.workflow.default_workflow_permissions !==
      props.workflow.default_workflow_permissions ||
    current.workflow.can_approve_pull_request_reviews !==
      props.workflow.can_approve_pull_request_reviews
  ) {
    yield* request('write workflow permissions', () =>
      client.rest.actions.setGithubActionsDefaultWorkflowPermissionsRepository({
        ...target,
        ...props.workflow
      })
    )
  }
  if (current.retention.days !== props.retention.days) {
    yield* request('write retention', () =>
      client.request(
        'PUT /repos/{owner}/{repo}/actions/permissions/artifact-and-log-retention',
        { ...target, ...props.retention }
      )
    )
  }
  if (current.forks.approval_policy !== props.forks.approval_policy) {
    yield* request('write fork approvals', () =>
      client.request(
        'PUT /repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval',
        { ...target, ...props.forks }
      )
    )
  }
  return yield* readGitHubControls(props)
})

export type GitHubControls = Resource<
  'Starter.GitHubControls',
  GitHubControlsProps,
  Effect.Success<ReturnType<typeof readGitHubControls>>
>
export const GitHubControls = Resource<GitHubControls>('Starter.GitHubControls')
export const GitHubControlsProvider = Provider.succeed(GitHubControls, {
  diff: ({ olds, news }) =>
    Effect.succeed(
      isResolved(news) &&
        (olds.owner !== news.owner || olds.repository !== news.repository)
        ? { action: 'replace' }
        : undefined
    ),
  read: Effect.fn(function* ({ output, olds }) {
    const target = output ?? olds
    return yield* readGitHubControls(target)
  }),
  reconcile: Effect.fn(function* ({ news }) {
    return yield* reconcileGitHubControls(news)
  }),
  // Repository policy survives removal of its management entry.
  delete: () => Effect.void
})
