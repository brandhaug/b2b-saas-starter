import type * as GitHub from '@alchemy.run/github'
import { type GitHubControlsProps } from './infra/github-controls.ts'

/** Repository policy, independent of Cloudflare application credentials. */
export const repositorySettings = {
  description:
    'Cloudflare-first B2B SaaS monorepo starter. TanStack Start, Effect v4, Drizzle on D1, Better Auth, Alchemy v2, REST + MCP, React Email, Storybook, Vitest, Playwright, oxlint, oxfmt, Vite+, pnpm.',
  homepage: 'https://b2b-saas-starter-web.brandhaug.workers.dev',
  visibility: 'public',
  hasIssues: true,
  hasProjects: false,
  hasWiki: false,
  hasDiscussions: false,
  isTemplate: false,
  allowSquashMerge: true,
  allowMergeCommit: false,
  allowRebaseMerge: false,
  allowAutoMerge: true,
  deleteBranchOnMerge: true,
  topics: [
    'alchemy',
    'b2b',
    'better-auth',
    'cloudflare',
    'cloudflare-workers',
    'd1',
    'drizzle-orm',
    'effect-ts',
    'mcp',
    'monorepo',
    'pnpm',
    'react-email',
    'saas',
    'saas-starter',
    'starter',
    'tanstack-start',
    'typescript',
    'vite',
    'vite-plus',
    'vitest'
  ]
} satisfies Omit<GitHub.RepositoryProps, 'owner' | 'name'>

/** Adopt the existing ruleset by its exact name, without weakening its checks. */
export const branchRules = {
  name: 'master: require CI and e2e',
  enforcement: 'active',
  target: 'branch',
  conditions: { include: ['~DEFAULT_BRANCH'], exclude: [] },
  bypassActors: [],
  rules: {
    requiredStatusChecks: {
      checks: [
        { context: 'ci', integrationId: 15_368 },
        { context: 'e2e', integrationId: 15_368 }
      ],
      strictRequiredStatusChecksPolicy: false
    }
  }
} satisfies Omit<GitHub.RulesetProps, 'owner' | 'repository'>

/** Preserve the current repository defaults; workflows declare narrower permissions. */
export const actionsSettings = {
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
} satisfies Omit<GitHubControlsProps, 'owner' | 'repository'>

export const labels = [
  { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
  {
    name: 'documentation',
    color: '0075ca',
    description: 'Improvements or additions to documentation'
  },
  {
    name: 'duplicate',
    color: 'cfd3d7',
    description: 'This issue or pull request already exists'
  },
  { name: 'enhancement', color: 'a2eeef', description: 'New feature or request' },
  { name: 'good first issue', color: '7057ff', description: 'Good for newcomers' },
  { name: 'help wanted', color: '008672', description: 'Extra attention is needed' },
  { name: 'invalid', color: 'e4e669', description: "This doesn't seem right" },
  {
    name: 'question',
    color: 'd876e3',
    description: 'Further information is requested'
  },
  {
    name: 'wayfinder:grilling',
    color: 'd93f0b',
    description: 'Wayfinder grilling ticket'
  },
  { name: 'wayfinder:map', color: '5319e7', description: 'Wayfinder map issue' },
  {
    name: 'wayfinder:prototype',
    color: 'fbca04',
    description: 'Wayfinder prototype ticket'
  },
  {
    name: 'wayfinder:research',
    color: '0e8a16',
    description: 'Wayfinder research ticket'
  },
  { name: 'wayfinder:task', color: '1d76db', description: 'Wayfinder task ticket' },
  { name: 'wontfix', color: 'ffffff', description: 'This will not be worked on' }
] satisfies Array<Omit<GitHub.LabelProps, 'owner' | 'repository'>>

/** Explicitly selected operator secret names. Values come from Config.redacted. */
export const repositorySecrets: Array<string> = []
