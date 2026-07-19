import type {
  ImpersonatedMerchantAction,
  ImpersonationAuthorization
} from '@b2b-saas-starter/capabilities/operations'
import { isImpersonatedMerchantMutation } from '@b2b-saas-starter/capabilities/operations'

export type MerchantRequestSession = {
  readonly session: {
    readonly id: string
    readonly impersonatedBy?: string | null | undefined
  }
  readonly user: { readonly id: string }
}

export type MerchantRequestAuthorityAdapter = {
  readonly authorize: (input: {
    readonly merchantSessionId: string
    readonly action: ImpersonatedMerchantAction
  }) => Promise<ImpersonationAuthorization>
  readonly recordMutation: (input: {
    readonly businessEventId: string
    readonly authorization: ImpersonationAuthorization
    readonly action: ImpersonatedMerchantAction
    readonly result: 'accepted' | 'rejected'
  }) => Promise<void>
}

export const makeMerchantRequestAuthority = <
  Session extends MerchantRequestSession
>(dependencies: {
  readonly readSession: () => Promise<Session | null>
  readonly authority: MerchantRequestAuthorityAdapter
  readonly unauthorized: () => Error
}) => {
  const recordMutation = async (input: {
    readonly businessEventId: string
    readonly authorization: ImpersonationAuthorization
    readonly action: ImpersonatedMerchantAction
    readonly result: 'accepted' | 'rejected'
  }) => {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await dependencies.authority.recordMutation(input)
        return
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  const authorize = async (action: ImpersonatedMerchantAction) => {
    const session = await dependencies.readSession()
    if (!session) throw dependencies.unauthorized()
    const authorization = session.session.impersonatedBy
      ? await dependencies.authority.authorize({
          merchantSessionId: session.session.id,
          action
        })
      : null
    return { session, authorization }
  }

  return {
    authorize,
    run: async <Result>(
      action: ImpersonatedMerchantAction,
      use: (session: Session) => Promise<Result>
    ): Promise<Result> => {
      const { session, authorization } = await authorize(action)
      const businessEventId = `impersonation-mutation:${crypto.randomUUID()}`
      let result: Result
      try {
        result = await use(session)
      } catch (error) {
        if (authorization && isImpersonatedMerchantMutation(action)) {
          await recordMutation({
            businessEventId,
            authorization,
            action,
            result: 'rejected'
          })
        }
        throw error
      }
      if (authorization && isImpersonatedMerchantMutation(action)) {
        await recordMutation({
          businessEventId,
          authorization,
          action,
          result: 'accepted'
        })
      }
      return result
    }
  }
}
