import { env } from 'cloudflare:workers'
import { createDb } from '@b2b-saas-starter/db/client'
import { createMerchantAuth } from '@b2b-saas-starter/auth'
import { createMerchantEmailDelivery } from './merchant-email.ts'

const localSecret = 'local-merchant-auth-secret-change-me-minimum-32-chars'
const localOrigin = 'http://localhost:3072'

const production = (): boolean =>
  env.ENVIRONMENT === 'production' || import.meta.env.PROD

export const createMerchantServerContext = () => {
  let authInstance: ReturnType<typeof createMerchantAuth> | undefined

  const auth = () => {
    if (!authInstance) {
      const isProduction = production()
      const emailDelivery = createMerchantEmailDelivery(env, isProduction)
      const baseURL = env.MERCHANT_AUTH_URL ?? localOrigin
      const trustedOrigins = (env.MERCHANT_AUTH_TRUSTED_ORIGINS ?? baseURL)
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
      authInstance = createMerchantAuth({
        db: createDb(env.DB),
        secret: env.MERCHANT_AUTH_SECRET ?? localSecret,
        baseURL,
        trustedOrigins,
        production: isProduction,
        sendVerificationEmail: emailDelivery.sendVerificationEmail,
        sendResetPassword: emailDelivery.sendResetPassword
      })
    }
    return authInstance
  }

  return {
    auth,
    emailDelivery: () => createMerchantEmailDelivery(env, production()),
    production
  }
}
