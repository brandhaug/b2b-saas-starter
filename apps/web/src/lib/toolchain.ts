import { GITHUB_URL } from '@/components/landing/github-url'

/**
 * The toolchain strings the public site prints, single-sourced.
 *
 * Every command a visitor can copy off a screen — hero, closing block, runtime
 * map, FAQ, quickstart — must come from here. The repo moved from Bun to pnpm
 * (managed by the Vite+ CLI) and from Turbo to Vite Task; drift between this
 * module and reality is exactly how the wrong toolchain ends up in the hero
 * again.
 */

/**
 * The quickstart's install-and-run block, command for command. The MDX
 * (`apps/web/content/docs/getting-started/quickstart.mdx`) is canonical and
 * `toolchain.test.ts` fails when a step here stops appearing there verbatim,
 * so the hero can never promise fewer commands than the docs deliver.
 */
export const SETUP_STEPS: ReadonlyArray<string> = [
  'vp install',
  'cp .env.example .env',
  'pnpm run db:migrate:local',
  'pnpm run db:seed',
  'pnpm run dev'
]

/** A complete paste from a parent directory, including checkout preparation. */
export const CLONE_AND_SETUP_STEPS: ReadonlyArray<string> = [
  `git clone ${GITHUB_URL}.git`,
  'cd b2b-saas-starter',
  ...SETUP_STEPS
]

/** Deployment is Alchemy IaC off the root script. */
export const DEPLOY_COMMAND = 'pnpm run deploy'

/**
 * The dev servers `pnpm run dev` boots, as the closing block lists them. Ports
 * and commands mirror `docs/setup.md` and the root scripts; nothing here is
 * invented output — it is a labelled "what you get", not a fake terminal.
 */
export const DEV_SERVERS: ReadonlyArray<{
  readonly label: string
  readonly value: string
}> = [
  { label: 'web', value: 'http://localhost:3071' },
  { label: 'api', value: 'pnpm -C apps/api dev' },
  { label: 'background', value: 'pnpm -C apps/background dev' },
  { label: 'providers', value: 'env-gated: nothing to configure' }
]
