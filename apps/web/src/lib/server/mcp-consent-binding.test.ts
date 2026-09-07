import { describe, expect, it } from 'vite-plus/test'

import { webMcpConsentBinding } from './mcp-consent-binding'

describe('webMcpConsentBinding without D1', () => {
  it('fails before claiming that the consent was session-bound', async () => {
    await expect(
      webMcpConsentBinding.bindSession({
        userId: 'usr_demo',
        clientId: 'https://client.example/metadata.json',
        workspaceId: 'wrk_starter',
        sessionId: 'ses_current'
      })
    ).rejects.toMatchObject({ _tag: 'MissingD1Binding', property: 'DB' })
  })
})
