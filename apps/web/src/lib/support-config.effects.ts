import { hasValue } from '@b2b-saas-starter/env/server'
import { env } from 'cloudflare:workers'
import { type SupportConfig } from './support-config'

const EMAIL = /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/

export function safeSupportEmail(value: string | null | undefined): string | undefined {
  return hasValue(value) && EMAIL.test(value) ? value : undefined
}

export function safeSupportUrl(value: string | null | undefined): string | undefined {
  if (!hasValue(value)) {
    return undefined
  }
  const parsed = URL.parse(value)
  return parsed?.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === ''
    ? value
    : undefined
}

/** The deployed release, named by whichever binding the platform set. */
function releaseVersion(): string | undefined {
  if (hasValue(env.SERVICE_VERSION)) {
    return env.SERVICE_VERSION
  }
  return hasValue(env.GIT_COMMIT_SHA) ? env.GIT_COMMIT_SHA : undefined
}

export function readSupportConfig(): SupportConfig {
  // Unset and unsafe values stay `undefined`, which the JSON response drops.
  return {
    email: safeSupportEmail(env.SUPPORT_EMAIL),
    helpdeskUrl: safeSupportUrl(env.SUPPORT_HELPDESK_URL),
    helpCenterUrl: safeSupportUrl(env.SUPPORT_HELP_CENTER_URL),
    appVersion: releaseVersion()
  }
}
