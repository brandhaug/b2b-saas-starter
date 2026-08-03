import { createAuthClient } from 'better-auth/react'

// No base URL is supplied: requests remain at the Merchant App origin.
export const merchantAuthClient = createAuthClient()
