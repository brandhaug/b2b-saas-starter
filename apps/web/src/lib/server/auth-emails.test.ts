import {
  makeAuthEmailSender,
  oneTimeCodeSubject,
  recipientLocale,
  sendBackupCodesRotatedEmail,
  sendPasskeyChangedEmail,
  sendPasswordChangedEmail,
  sendTwoFactorChangedEmail
} from './auth-emails'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import type * as EmailModule from '@b2b-saas-starter/email'

const captured = vi.hoisted(() => {
  // The real Cloudflare dispatcher renders both representations before it
  // invokes the binding. Keeping this at the binding seam tests the sender's
  // locale lookup and the production render path together.
  const outbox: Array<EmailModule.SendEmailBuilderArgs> = []
  return { outbox }
})

vi.mock('@b2b-saas-starter/email', async (importOriginal) => {
  const actual = await importOriginal<typeof EmailModule>()
  return {
    ...actual,
    selectEmailDispatcherLayer: () =>
      actual.makeCloudflareEmailDispatcherLayer(
        {
          send: async (message) => {
            captured.outbox.push(message)
          }
        },
        { defaultFrom: 'test@example.com' }
      )
  }
})

describe('recipient auth email locale', () => {
  beforeEach(() => {
    captured.outbox = []
  })

  it('uses saved Bokmål for the real OTP and magic-link sends', async () => {
    const sender = makeAuthEmailSender()
    await sender.sendOneTimeCode({
      email: 'MARTIN@EXAMPLE.COM',
      otp: '123456',
      type: 'sign-in'
    })
    await sender.sendMagicLink({
      email: 'martin@example.com',
      url: 'https://app.test/magic'
    })

    expect(captured.outbox).toHaveLength(2)
    expect(captured.outbox[0]?.subject).toBe('Innloggingskoden din')
    expect(captured.outbox[0]?.html).toContain('Innloggingskoden din')
    expect(captured.outbox[0]?.text).toContain('Bruk koden nedenfor for å fortsette.')
    expect(captured.outbox[1]?.subject).toBe('Innloggingslenken din')
    expect(captured.outbox[1]?.html).toContain('Innloggingslenken din')
    expect(captured.outbox[1]?.text).toContain('Noen ba om en innloggingslenke')
  })

  it('falls back to English for an unknown recipient on the real send path', async () => {
    const sender = makeAuthEmailSender()
    await sender.sendOneTimeCode({
      email: 'new@example.com',
      otp: '123456',
      type: 'sign-in'
    })
    await sender.sendMagicLink({
      email: 'unknown@example.com',
      url: 'https://app.test/magic'
    })

    expect(captured.outbox[0]?.subject).toBe('Your sign-in code')
    expect(captured.outbox[0]?.text).toContain('Use the code below to continue.')
    expect(captured.outbox[1]?.subject).toBe('Your sign-in link')
    expect(captured.outbox[1]?.text).toContain('Somebody asked for a sign-in link')
  })

  it('exposes the English fallback for preference lookup', async () => {
    expect(await recipientLocale('new@example.com')).toBe('en')
    expect(oneTimeCodeSubject('sign-in', 'nb')).toBe('Innloggingskoden din')
  })

  it('localizes security callbacks from the saved recipient preference', async () => {
    await sendTwoFactorChangedEmail({ email: 'MARTIN@EXAMPLE.COM', enabled: true })
    await sendPasskeyChangedEmail({ email: 'martin@example.com', added: true })
    await sendPasswordChangedEmail({ email: 'martin@example.com' })
    await sendBackupCodesRotatedEmail({ email: 'martin@example.com' })

    expect(captured.outbox.map((message) => message.subject)).toEqual([
      'Tofaktorautentisering er endret',
      'Passnøkkel lagt til på kontoen din',
      'Passordet ditt ble endret',
      'Gjenopprettingskodene for tofaktorautentisering er erstattet'
    ])
    expect(captured.outbox[0]?.text).toContain('Tofaktorautentisering ble slått på.')
    expect(captured.outbox[1]?.text).toContain('En passnøkkel ble lagt til')
    expect(captured.outbox[2]?.text).toContain('Passordet for B2B SaaS Starter-kontoen')
    expect(captured.outbox[3]?.text).toContain(
      'De tidligere lagrede gjenopprettingskodene'
    )
  })
})
