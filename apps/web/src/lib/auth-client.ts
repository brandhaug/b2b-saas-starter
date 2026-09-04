import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { passkeyClient } from '@better-auth/passkey/client'
import { ssoClient } from '@better-auth/sso/client'
import {
  adminClient,
  emailOTPClient,
  lastLoginMethodClient,
  twoFactorClient,
  usernameClient
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  // `oauthProviderClient` attaches the page's signed OAuth query to sign-in
  // requests, which is how a sign-in that started from an MCP client's
  // authorization request resumes that authorization (ADR 0054).
  plugins: [
    usernameClient(),
    adminClient(),
    twoFactorClient(),
    emailOTPClient(),
    passkeyClient(),
    ssoClient(),
    lastLoginMethodClient(),
    oauthProviderClient()
  ]
})
