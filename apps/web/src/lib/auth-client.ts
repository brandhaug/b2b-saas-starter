import { passkeyClient } from '@better-auth/passkey/client'
import {
  adminClient,
  twoFactorClient,
  usernameClient
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  plugins: [usernameClient(), adminClient(), twoFactorClient(), passkeyClient()]
})
