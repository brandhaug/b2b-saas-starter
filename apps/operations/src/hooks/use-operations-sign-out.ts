'use client'

import { useState } from 'react'
import { operationsAuthClient } from '@b2b-saas-starter/auth/operations/client'

export function useOperationsSignOut(): {
  pending: boolean
  signOut: () => void
} {
  const [pending, setPending] = useState(false)

  const signOut = (): void => {
    setPending(true)
    void operationsAuthClient.signOut().then(({ error }) => {
      if (!error) window.location.assign('/sign-in')
      else setPending(false)
    })
  }

  return { pending, signOut }
}
