import { Effect, Schema } from 'effect'
import { Command } from 'foldkit'
import { focus } from 'foldkit/dom'
import { authClient } from '@/lib/auth-client'
import { navigateDocument } from '@/lib/document-navigation'
import { authErrorCopy, signInFailed } from '@/lib/auth-error-copy'
import { carriedOAuthSearch, oauthContinuationUrl } from '@/lib/oauth-continuation'
import { safeRedirect } from '@/lib/utils'
import { resolveSsoRoutingServerFn } from '@/lib/server/workspace-sso'
import {
  strongAuthenticationStatusServerFn,
  verifyCurrentPasswordServerFn
} from '@/lib/server/strong-authentication'
import {
  requestPasswordResetCodeWithAuthClient,
  requestPasswordResetWithAuthClient,
  sendEmailCodeWithAuthClient,
  sendMagicLinkWithAuthClient,
  signUpWithAuthClient
} from '@/components/auth/auth-client-ports'
import { type AuthResult } from '@/lib/auth-result'
import { m } from '@b2b-saas-starter/i18n/messages'
import { Message, Model, Operation } from './model'
import { setLocale } from '@b2b-saas-starter/i18n/runtime'
import { setLocalePreferencesServerFn } from '@/lib/server/account-preferences'
import { call } from '../server-call'

const { Failed, Sent, CompletedDom } = Message.cases
const isTwoFactorRedirect = Schema.is(
  Schema.Struct({ twoFactorRedirect: Schema.Literal(true) })
)
const decodeSsoDestination = Schema.decodeUnknownOption(
  Schema.Struct({ url: Schema.String })
)

function finish(
  result: AuthResult,
  model: Model
): Extract<Message, { _tag: 'Failed' | 'CompletedDom' }> {
  if (result.error) {
    return Failed.make({
      request: model.request,
      error: authErrorCopy(result.error, signInFailed())
    })
  }
  const search = new URLSearchParams(model.flags.search)
  const data = result.data
  if (isTwoFactorRedirect(data)) {
    const oauth = carriedOAuthSearch(model.flags.search)
    const redirect = search.get('redirect')
    navigateDocument(
      `/two-factor${oauth || (redirect ? `?redirect=${encodeURIComponent(redirect)}` : '')}`
    )
  } else {
    navigateDocument(
      oauthContinuationUrl(data) ?? safeRedirect(search.get('redirect') ?? undefined)
    )
  }
  return CompletedDom.make({})
}

async function exchange(
  model: Model,
  operation: Operation
): Promise<
  Extract<Message, { _tag: 'Failed' | 'Sent' | 'CompletedDom' | 'EnrollmentRequired' }>
> {
  const { email, password, name, code } = model.fields
  const search = new URLSearchParams(model.flags.search)
  const redirect = search.get('redirect') ?? undefined
  const turnstileToken = model.token ?? undefined
  function fail(result: AuthResult, fallback: string) {
    return result.error
      ? Failed.make({
          request: model.request,
          error: authErrorCopy(result.error, fallback)
        })
      : null
  }
  function sent(stage: 'code' | 'sent') {
    return Sent.make({ request: model.request, stage })
  }
  switch (operation) {
    case 'verify-current-password':
    case 'verify-current-passkey': {
      const recent = search.get('recent') === 'true'
      function denied() {
        return Failed.make({
          request: model.request,
          error: m.security_verification_failed()
        })
      }
      if (operation === 'verify-current-passkey') {
        const result: AuthResult = await authClient.signIn.passkey()
        if (result.error || result.data === null || result.data === undefined) {
          return denied()
        }
      } else {
        if (!(await verifyCurrentPasswordServerFn({ data: { password } }))) {
          return denied()
        }
        if (!model.flags.twoFactorEnabled && !recent) {
          return Message.cases.EnrollmentRequired.make({ request: model.request })
        }
        if (model.flags.twoFactorEnabled) {
          const result = await authClient.twoFactor.verifyTotp({
            code,
            trustDevice: false
          })
          if (result.error) {
            return denied()
          }
        }
      }
      const current = await strongAuthenticationStatusServerFn()
      if (recent ? !current.recent : !current.qualified) {
        return denied()
      }
      navigateDocument(safeRedirect(redirect))
      return CompletedDom.make({})
    }
    case 'password': {
      const routing = await resolveSsoRoutingServerFn({ data: { email } }).catch(
        () => null
      )
      if (routing !== null) {
        const result = await authClient.signIn.sso({
          email,
          callbackURL: `${window.location.origin}${safeRedirect(redirect)}`
        })
        const destination = decodeSsoDestination(result.data)
        if (result.error || destination._tag === 'None') {
          return Failed.make({
            request: model.request,
            error: authErrorCopy(result.error, m.sso_failed())
          })
        }
        navigateDocument(destination.value.url)
        return CompletedDom.make({})
      }
      return finish(await authClient.signIn.email({ email, password }), model)
    }
    case 'sign-up': {
      const result = await signUpWithAuthClient({
        name,
        email,
        password,
        turnstileToken,
        callbackPath: redirect
          ? `/verify-email?redirect=${encodeURIComponent(safeRedirect(redirect))}`
          : undefined
      })
      return fail(result, m.public_auth_sign_up_failed()) ?? finish(result, model)
    }
    case 'magic-link': {
      const result = await sendMagicLinkWithAuthClient({ email, turnstileToken })
      return fail(result, m.auth_send_link_failed()) ?? sent('sent')
    }
    case 'reset-link': {
      const result = await requestPasswordResetWithAuthClient({ email, turnstileToken })
      return fail(result, m.public_auth_request_failed()) ?? sent('sent')
    }
    case 'reset-code': {
      const result = await requestPasswordResetCodeWithAuthClient({
        email,
        turnstileToken
      })
      return (
        fail(
          result,
          model.stage === 'code'
            ? m.public_auth_resend_code_failed()
            : m.public_auth_send_code_failed()
        ) ?? sent('code')
      )
    }
    case 'send-code': {
      const purpose =
        model.flags.page === 'verify-email' ? 'email-verification' : 'sign-in'
      const result = await sendEmailCodeWithAuthClient({
        email,
        purpose,
        turnstileToken
      })
      return (
        fail(
          result,
          model.stage === 'code'
            ? m.public_auth_resend_code_failed()
            : m.public_auth_send_code_failed()
        ) ?? sent('code')
      )
    }
    case 'verify-code': {
      if (model.flags.page === 'forgot-password') {
        const result = await authClient.emailOtp.resetPassword({
          email,
          otp: code,
          password
        })
        const failure = fail(result, m.reset_failed())
        if (failure) {
          return failure
        }
        navigateDocument('/sign-in')
        return CompletedDom.make({})
      }
      const result =
        model.flags.page === 'verify-email'
          ? await authClient.emailOtp.verifyEmail({ email, otp: code })
          : await authClient.signIn.emailOtp({ email, otp: code })
      return fail(result, m.public_auth_verification_failed()) ?? finish(result, model)
    }
    case 'reset-password': {
      const result = await authClient.resetPassword({
        newPassword: password,
        token: search.get('token') ?? ''
      })
      const failure = fail(result, m.public_auth_reset_failed())
      if (failure) {
        return failure
      }
      navigateDocument('/sign-in')
      return CompletedDom.make({})
    }
    case 'totp': {
      return finish(
        await authClient.twoFactor.verifyTotp({ code, trustDevice: model.trustDevice }),
        model
      )
    }
    case 'backup': {
      return finish(
        await authClient.twoFactor.verifyBackupCode({
          code: code.trim(),
          trustDevice: model.trustDevice
        }),
        model
      )
    }
    case 'passkey': {
      const result: AuthResult = await authClient.signIn.passkey()
      if (!result.error && (result.data === null || result.data === undefined)) {
        return Failed.make({
          request: model.request,
          error: m.public_auth_passkey_sign_in_failed()
        })
      }
      return finish(result, model)
    }
    case 'github':
    case 'google': {
      const result = await authClient.signIn.social({
        provider: operation,
        callbackURL: `${window.location.origin}${safeRedirect(redirect)}`,
        errorCallbackURL: `${window.location.origin}/sign-in?redirect=${encodeURIComponent(safeRedirect(redirect))}`
      })
      return fail(result, signInFailed()) ?? CompletedDom.make({})
    }
  }
}

export const Exchange = Command.define('Auth.Exchange', {
  args: { model: Model, operation: Operation },
  messages: [Failed, Sent, CompletedDom, Message.cases.EnrollmentRequired],
  execute: ({ model, operation }) =>
    Effect.tryPromise({
      try: () => exchange(model, operation),
      catch: () =>
        Failed.make({ request: model.request, error: m.public_auth_request_failed() })
    }).pipe(Effect.catch((error) => Effect.succeed(error)))
})

export const Focus = Command.define('Auth.Focus', {
  args: { id: Schema.String },
  messages: [CompletedDom],
  execute: ({ id }) =>
    Effect.sync(() => {
      if (id === 'password' || id === 'demo-credentials-trigger') {
        const dialog = document.getElementById('demo-credentials')
        if (dialog instanceof HTMLDialogElement && dialog.open) {
          dialog.close()
        }
      }
    }).pipe(
      Effect.andThen(focus(`#${id}`)),
      Effect.ignore,
      Effect.as(CompletedDom.make({}))
    )
})

export const Ready = Command.define('Auth.Ready', {
  messages: [Message.cases.Ready],
  execute: Effect.sync(() =>
    Message.cases.Ready.make({ lastLoginMethod: authClient.getLastUsedLoginMethod() })
  )
})

export function digitId(index: number): string {
  return index === 0 ? 'code' : `code-${index}`
}
export const SelectDigit = Command.define('Auth.SelectDigit', {
  args: { index: Schema.Number },
  messages: [CompletedDom],
  execute: ({ index }) =>
    Effect.sync(() => {
      const cell = document.getElementById(digitId(index))
      if (cell instanceof HTMLInputElement) {
        cell.select()
      }
      return CompletedDom.make({})
    })
})

export const ChangeLocale = Command.define('Auth.ChangeLocale', {
  args: {
    locale: Schema.Literals(['en', 'nb']),
    authenticated: Schema.Boolean,
    request: Schema.Number
  },
  messages: [Failed, CompletedDom],
  execute: ({ locale, authenticated, request }) =>
    Effect.gen(function* () {
      if (authenticated) {
        yield* call(
          () => setLocalePreferencesServerFn({ data: { locale } }),
          m.shell_save_error()
        )
      }
      yield* Effect.promise(async () => {
        await setLocale(locale)
      })
      return CompletedDom.make({})
    }).pipe(
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Failed.make({ request, error: error.message }))
      )
    )
})
