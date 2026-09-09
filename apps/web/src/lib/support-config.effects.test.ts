import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  readSupportConfig,
  safeSupportEmail,
  safeSupportUrl
} from './support-config.effects'

const bindings = vi.hoisted(() => ({
  SUPPORT_EMAIL: '',
  SUPPORT_HELPDESK_URL: '',
  SUPPORT_HELP_CENTER_URL: '',
  SERVICE_VERSION: '',
  GIT_COMMIT_SHA: ''
}))
vi.mock('cloudflare:workers', () => ({ env: bindings }))
beforeEach(() => {
  bindings.SUPPORT_EMAIL = ''
  bindings.SUPPORT_HELPDESK_URL = ''
  bindings.SUPPORT_HELP_CENTER_URL = ''
  bindings.SERVICE_VERSION = ''
  bindings.GIT_COMMIT_SHA = ''
})

describe('support destination validation', () => {
  it('accepts a normal email and HTTPS URL', () => {
    expect(safeSupportEmail('help@example.test')).toBe('help@example.test')
    expect(safeSupportUrl('https://support.example.test/tickets')).toBe(
      'https://support.example.test/tickets'
    )
  })

  it('rejects malformed email and unsafe destinations', () => {
    expect(safeSupportEmail('help@example.test?subject=secret')).toBeUndefined()
    expect(safeSupportUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeSupportUrl('//evil.example')).toBeUndefined()
    expect(safeSupportUrl('https://user:pass@support.example.test')).toBeUndefined()
  })
})

describe('public support configuration', () => {
  it('stays empty without providers, a session or a database', () => {
    expect(readSupportConfig()).toEqual({})
  })

  it('hides invalid destinations and retains valid alternatives and release identity', () => {
    bindings.SUPPORT_EMAIL = 'help@example.test'
    bindings.SUPPORT_HELPDESK_URL = 'javascript:alert(1)'
    bindings.SUPPORT_HELP_CENTER_URL = 'https://docs.example.test'
    bindings.GIT_COMMIT_SHA = 'commit-288'
    expect(readSupportConfig()).toEqual({
      email: 'help@example.test',
      helpCenterUrl: 'https://docs.example.test',
      appVersion: 'commit-288'
    })
  })
})
