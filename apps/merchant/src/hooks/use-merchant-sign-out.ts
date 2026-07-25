'use client'

import { useState } from 'react'
import { merchantAuthClient } from '@/lib/auth-client.ts'

const signOutFailureMessage = 'We could not sign you out. Please try again.'

export function useMerchantSignOut(): {
  readonly error: string | null
  readonly pending: boolean
  readonly signOut: () => void
} {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signOut = () => {
    if (pending) return
    setPending(true)
    setError(null)
    void merchantAuthClient.signOut().then(
      (result) => {
        if (!result.error) {
          window.location.assign('/sign-in')
          return
        }
        setPending(false)
        setError(signOutFailureMessage)
      },
      () => {
        setPending(false)
        setError(signOutFailureMessage)
      }
    )
  }

  return { error, pending, signOut }
}
