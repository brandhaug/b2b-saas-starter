import { hasValue } from '@b2b-saas-starter/env/server'
import { env } from 'cloudflare:workers'
import { type SupportConfig } from './support-config'

const EMAIL = /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/
type MutableSupportConfig = {
  email?: string
  helpdeskUrl?: string
  helpCenterUrl?: string
  appVersion?: string
}

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

export function readSupportConfig(): SupportConfig {
  const email = safeSupportEmail(env.SUPPORT_EMAIL)
  const helpdeskUrl = safeSupportUrl(env.SUPPORT_HELPDESK_URL)
  const helpCenterUrl = safeSupportUrl(env.SUPPORT_HELP_CENTER_URL)
  let appVersion: string | undefined
  if (hasValue(env.SERVICE_VERSION)) {
    appVersion = env.SERVICE_VERSION
  } else if (hasValue(env.GIT_COMMIT_SHA)) {
    appVersion = env.GIT_COMMIT_SHA
  }
  const result: MutableSupportConfig = {}
  if (email !== undefined) {
    result.email = email
  }
  if (helpdeskUrl !== undefined) {
    result.helpdeskUrl = helpdeskUrl
  }
  if (helpCenterUrl !== undefined) {
    result.helpCenterUrl = helpCenterUrl
  }
  if (appVersion !== undefined) {
    result.appVersion = appVersion
  }
  return result
}
