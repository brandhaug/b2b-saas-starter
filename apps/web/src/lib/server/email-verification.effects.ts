import { readOptionalSession } from './auth'

/** Project only the verified bit needed by the public landing page. */
export async function readEmailVerificationStatusHandler(): Promise<boolean> {
  const session = await readOptionalSession()
  return session?.user.emailVerified === true
}
