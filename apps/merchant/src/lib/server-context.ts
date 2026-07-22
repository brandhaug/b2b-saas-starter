import { env } from 'cloudflare:workers'
import { createDb } from '@b2b-saas-starter/db/client'
import { createMerchantAuth } from '@b2b-saas-starter/auth'
import { resolveMerchantAuthConfig } from './merchant-auth-config.ts'
import { createMerchantEmailDelivery } from './merchant-email.ts'

const production = (): boolean =>
  env.ENVIRONMENT === 'production' || import.meta.env.PROD

export const createMerchantServerContext = () => {
  let authInstance: ReturnType<typeof createMerchantAuth> | undefined
  let dbInstance: ReturnType<typeof createDb> | undefined

  const db = () => (dbInstance ??= createDb(env.DB))

  const auth = () => {
    if (!authInstance) {
      const isProduction = production()
      const emailDelivery = createMerchantEmailDelivery(env, isProduction)
      const config = resolveMerchantAuthConfig(env, isProduction)
      authInstance = createMerchantAuth({
        db: db(),
        ...config,
        production: isProduction,
        sendVerificationEmail: emailDelivery.sendVerificationEmail,
        sendResetPassword: emailDelivery.sendResetPassword
      })
    }
    return authInstance
  }

  return {
    auth,
    db,
    emailDelivery: () => createMerchantEmailDelivery(env, production()),
    production,
    merchantOrigin: () => resolveMerchantAuthConfig(env, production()).baseURL,
    merchantSecret: () => resolveMerchantAuthConfig(env, production()).secret
  }
}
