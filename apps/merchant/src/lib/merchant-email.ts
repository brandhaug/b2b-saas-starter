export type MerchantEmailBinding = {
  readonly send: (message: {
    readonly from: string
    readonly to: string
    readonly subject: string
    readonly text: string
    readonly html: string
  }) => Promise<unknown>
}

import type { MerchantAuthEmail } from '@b2b-saas-starter/auth'

export type { MerchantAuthEmail }

export type MerchantEmailDelivery = {
  readonly isConfigured: boolean
  readonly sendVerificationEmail: (data: MerchantAuthEmail) => Promise<void>
  readonly sendResetPassword: (data: MerchantAuthEmail) => Promise<void>
}

type MerchantEmailEnvironment = {
  readonly EMAIL?: MerchantEmailBinding
  readonly CLOUDFLARE_EMAIL_FROM?: string
}

const html = (heading: string, action: string, url: string): string =>
  `<h1>${heading}</h1><p>${action}</p><p><a href="${url}">${url}</a></p>`

const localLinkDelivery =
  (kind: 'verification' | 'reset') =>
  async ({ url }: MerchantAuthEmail): Promise<void> => {
    // URLs are intentionally printed in local development so verification and
    // reset flows stay usable without an email provider. The submitted email
    // is never included in this log entry.
    // oxlint-disable-next-line no-console -- the local server terminal is the provider-light delivery surface
    console.info(`merchant auth ${kind} link: ${url}`)
  }

export const createMerchantEmailDelivery = (
  env: MerchantEmailEnvironment,
  production: boolean
): MerchantEmailDelivery => {
  const from = env.CLOUDFLARE_EMAIL_FROM
  const binding = env.EMAIL

  if (!production) {
    return {
      isConfigured: true,
      sendVerificationEmail: localLinkDelivery('verification'),
      sendResetPassword: localLinkDelivery('reset')
    }
  }

  if (!binding || !from) {
    // The HTTP boundary rejects every operation that might send email before
    // Better Auth calls this fallback. It remains a no-op only to keep the
    // provider callback total if Better Auth introduces another email path.
    const unavailable = async (): Promise<void> => undefined
    return {
      isConfigured: false,
      sendVerificationEmail: unavailable,
      sendResetPassword: unavailable
    }
  }

  return {
    isConfigured: true,
    sendVerificationEmail: async ({ user, url }) => {
      await binding.send({
        from,
        to: user.email,
        subject: 'Verify your Merchant App email',
        text: `Verify your Merchant App email: ${url}`,
        html: html(
          'Verify your Merchant App email',
          'Use this link to verify your Merchant App email.',
          url
        )
      })
    },
    sendResetPassword: async ({ user, url }) => {
      await binding.send({
        from,
        to: user.email,
        subject: 'Reset your Merchant App password',
        text: `Reset your Merchant App password: ${url}`,
        html: html(
          'Reset your Merchant App password',
          'Use this link to reset your Merchant App password.',
          url
        )
      })
    }
  }
}
