import { createServerFn } from '@tanstack/react-start'

export const getEmailVerificationStatusServerFn = createServerFn({
  method: 'GET'
}).handler(async (): Promise<boolean> => {
  const { readEmailVerificationStatusHandler } =
    await import('./email-verification.effects')
  return readEmailVerificationStatusHandler()
})
