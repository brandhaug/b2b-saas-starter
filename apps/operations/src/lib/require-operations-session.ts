import { redirect } from '@tanstack/react-router'
import { getOperationsSession } from './server/operations-server-functions.ts'

export const requireOperationsSession = async () => {
  const session = await getOperationsSession()
  if (session.state === 'unauthenticated' || session.state === 'expired') {
    throw redirect({
      to: '/sign-in',
      search: { error: undefined, result: undefined }
    })
  }
  return { session }
}
