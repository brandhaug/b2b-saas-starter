import { hasValue, type ProviderEnvOf } from '@b2b-saas-starter/env/server'

export type SsoPolicyOptions = {
  readonly proofTtlMs?: number | undefined
  readonly configurationAuthRecencyMs?: number | undefined
}

function secondsOption(value: string | undefined, maximum: number): number | undefined {
  if (!hasValue(value)) {
    return undefined
  }
  const seconds = Number(value)
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > maximum) {
    return undefined
  }
  return seconds * 1000
}

/** Invalid settings retain the conservative defaults; unset values need no provider setup. */
export function ssoPolicyOptionsFromEnv(
  env: ProviderEnvOf<'SSO_PROOF_TTL_SECONDS' | 'SSO_CONFIGURATION_AUTH_MAX_AGE_SECONDS'>
): SsoPolicyOptions {
  return {
    proofTtlMs: secondsOption(env.SSO_PROOF_TTL_SECONDS, 7 * 24 * 60 * 60),
    configurationAuthRecencyMs: secondsOption(
      env.SSO_CONFIGURATION_AUTH_MAX_AGE_SECONDS,
      60 * 60
    )
  }
}
