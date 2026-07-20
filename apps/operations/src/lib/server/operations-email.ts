export type OperationsEmailBinding = {
  readonly send: (message: {
    readonly from: string
    readonly to: string
    readonly subject: string
    readonly text: string
    readonly html: string
  }) => Promise<unknown>
}

type OperationsEmailEnvironment = {
  readonly EMAIL?: OperationsEmailBinding
  readonly CLOUDFLARE_EMAIL_FROM?: string
}

export type OperatorInvitationDelivery = {
  readonly configured: boolean
  readonly send: (input: {
    readonly email: string
    readonly url: string
  }) => Promise<void>
}

let localInvitationEmail: { readonly email: string; readonly url: string } | undefined

export const readLocalOperatorInvitationEmail = () => localInvitationEmail

export const createOperatorInvitationDelivery = (
  env: OperationsEmailEnvironment,
  production: boolean
): OperatorInvitationDelivery => {
  const binding = env.EMAIL
  const from = env.CLOUDFLARE_EMAIL_FROM

  if (!production && (!binding || !from)) {
    return {
      configured: true,
      send: async ({ email, url }) => {
        // Local development keeps one in-memory delivery for the dedicated
        // local email-capture route. Credentials never enter operational logs.
        localInvitationEmail = { email, url }
      }
    }
  }

  if (!binding || !from) {
    return { configured: false, send: async () => undefined }
  }

  return {
    configured: true,
    send: async ({ email, url }) => {
      await binding.send({
        from,
        to: email,
        subject: 'Complete your System Operator enrollment',
        text: `Complete your System Operator enrollment: ${url}`,
        html: `<h1>System Operator enrollment</h1><p>Use this single-use link to verify your email and begin security enrollment.</p><p><a href="${url}">${url}</a></p>`
      })
    }
  }
}
