import { createServerFn } from '@tanstack/react-start'

/**
 * The client-safe server-function half of the email-verification status read.
 * The session lookup stays behind the lazy effects import so route loaders can
 * call this during client navigation without shipping server auth code.
 */
export const getEmailVerificationStatusServerFn = createServerFn({
  method: 'GET'
}).handler(async (): Promise<boolean> => {
  const { readEmailVerificationStatusHandler } =
    await import('./email-verification.effects')
  return readEmailVerificationStatusHandler()
})
