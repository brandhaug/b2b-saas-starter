/**
 * The toolchain strings the public site prints, single-sourced.
 *
 * Every command a visitor can copy off a screen — hero, closing block, runtime
 * map, FAQ, quickstart — must come from here. The repo moved from Bun to pnpm
 * (managed by the Vite+ CLI) and from Turbo to Vite Task; drift between this
 * module and reality is exactly how the wrong toolchain ends up in the hero
 * again.
 */

/** The two commands that clone-to-running, as printed in the hero. */
export const INSTALL_COMMAND = 'pnpm install'
export const DEV_COMMAND = 'pnpm run dev'

/** Same story, one string: the hero's copy-paste line. */
export const INSTALL_AND_RUN = `${INSTALL_COMMAND} && ${DEV_COMMAND}`

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
  { label: 'providers', value: 'env-gated — nothing to configure' }
]
