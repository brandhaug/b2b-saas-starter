import { passkeyClient } from '@better-auth/passkey/client'
import { ssoClient } from '@better-auth/sso/client'
import {
  adminClient,
  lastLoginMethodClient,
  twoFactorClient,
  usernameClient
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  plugins: [
    usernameClient(),
    adminClient(),
    twoFactorClient(),
    passkeyClient(),
    ssoClient(),
    lastLoginMethodClient()
  ]
})
