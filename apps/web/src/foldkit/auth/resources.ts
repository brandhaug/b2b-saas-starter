import { Effect, Option, Queue, Schema, Stream } from 'effect'
import { ManagedResource, Subscription, Render } from 'foldkit'
import { Message, type Model, submitOperation } from './model'
import { mountLightRays } from '../light-rays'
import { authClient } from '@/lib/auth-client'
import { type AuthResult } from '@/lib/auth-result'
import { conditionalMediationAvailable } from '@/lib/webauthn-support'
import { oauthContinuationUrl } from '@/lib/oauth-continuation'
import { safeRedirect } from '@/lib/utils'

const DemoDialog = ManagedResource.tag<HTMLDialogElement>()('Auth.DemoDialog')
const LightRays = ManagedResource.tag<() => void>()('Auth.LightRays')
const LocaleDialog = ManagedResource.tag<HTMLDialogElement>()('Auth.LocaleDialog')

function acquireDialog(id: string) {
  return Render.afterCommit.pipe(
    Effect.andThen(
      Effect.suspend(() => {
        const dialog = document.getElementById(id)
        if (!(dialog instanceof HTMLDialogElement)) {
          return Effect.fail('MissingDialog' as const)
        }
        return Effect.try({
          try: () => {
            dialog.showModal()
            return dialog
          },
          catch: () => 'MissingDialog' as const
        })
      })
    )
  )
}

function dismissals(id: string, message: Message) {
  return Stream.unwrap(
    Render.afterCommit.pipe(
      Effect.andThen(
        Effect.sync(() => {
          const dialog = document.getElementById(id)
          if (!dialog) {
            return Stream.empty
          }
          return Stream.fromEventListener<Event>(dialog, 'cancel').pipe(
            Stream.map((event) => {
              event.preventDefault()
              return message
            })
          )
        })
      )
    )
  )
}

export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  localeDialog: entry(Schema.Option(Schema.Null), {
    resource: LocaleDialog,
    modelToMaybeRequirements: (model) =>
      model.localeTarget !== null && !model.pending ? Option.some(null) : Option.none(),
    acquire: () => acquireDialog('auth-locale-confirm'),
    release: (dialog) => Effect.sync(() => dialog.close()),
    onAcquired: () => Message.cases.CompletedDom.make({}),
    onReleased: () => Message.cases.CompletedDom.make({}),
    onAcquireError: () => Message.cases.CancelledLocale.make({})
  }),
  lightRays: entry(Schema.Option(Schema.Null), {
    resource: LightRays,
    modelToMaybeRequirements: (model) =>
      model.ready && (model.flags.page === 'sign-in' || model.flags.page === 'sign-up')
        ? Option.some(null)
        : Option.none(),
    acquire: () =>
      Effect.sync(() => {
        const canvas = document.getElementById('auth-light-rays')
        return canvas instanceof HTMLCanvasElement
          ? mountLightRays(canvas)
          : () => undefined
      }),
    release: (dispose) => Effect.sync(dispose),
    onAcquired: () => Message.cases.CompletedDom.make({}),
    onReleased: () => Message.cases.CompletedDom.make({}),
    onAcquireError: () => Message.cases.CompletedDom.make({})
  }),
  demoDialog: entry(Schema.Option(Schema.Null), {
    resource: DemoDialog,
    modelToMaybeRequirements: (model) =>
      model.demoOpen ? Option.some(null) : Option.none(),
    acquire: () => acquireDialog('demo-credentials'),
    release: (dialog) => Effect.sync(() => dialog.close()),
    onAcquired: () => Message.cases.CompletedDom.make({}),
    onReleased: () => Message.cases.CompletedDom.make({}),
    onAcquireError: () => Message.cases.DemoClosed.make({})
  })
}))

export function needsChallenge(model: Model): boolean {
  return (
    model.flags.turnstileSiteKey !== null &&
    model.stage !== 'sent' &&
    (['sign-up', 'magic-link', 'reset-link', 'reset-code', 'send-code'].includes(
      submitOperation(model)
    ) ||
      model.stage === 'code')
  )
}

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  passkeyAutofill: entry(
    { active: Schema.Boolean, search: Schema.String },
    {
      modelToDependencies: (model) => ({
        active: model.ready && model.flags.page === 'sign-in' && model.request === 0,
        search: model.flags.search
      }),
      dependenciesToStream: ({ active, search }) =>
        active
          ? Stream.callback<Message>((queue) =>
              Effect.tryPromise({
                try: async (signal) => {
                  if ((await conditionalMediationAvailable()) && !signal.aborted) {
                    Queue.offerUnsafe(
                      queue,
                      Message.cases.AutofillPending.make({ pending: true })
                    )
                    const result: AuthResult = await authClient.signIn.passkey({
                      autoFill: true
                    })
                    if (
                      // oxlint-disable-next-line typescript/no-unnecessary-condition -- The subscription can abort during the awaited credential ceremony.
                      !signal.aborted &&
                      !result.error &&
                      result.data !== null &&
                      result.data !== undefined
                    ) {
                      window.location.assign(
                        oauthContinuationUrl(result.data) ??
                          safeRedirect(
                            new URLSearchParams(search).get('redirect') ?? undefined
                          )
                      )
                    }
                  }
                },
                catch: () => undefined
              }).pipe(
                Effect.ignore,
                Effect.ensuring(
                  Effect.sync(() => {
                    Queue.offerUnsafe(
                      queue,
                      Message.cases.AutofillPending.make({ pending: false })
                    )
                  })
                )
              )
            )
          : Stream.empty
    }
  ),
  localeDismiss: entry(
    { open: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        open: model.localeTarget !== null && !model.pending
      }),
      dependenciesToStream: ({ open }) =>
        open
          ? dismissals('auth-locale-confirm', Message.cases.CancelledLocale.make({}))
          : Stream.empty
    }
  ),
  resendCooldown: entry(
    { active: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ active: model.cooldown > 0 }),
      dependenciesToStream: ({ active }) =>
        active
          ? Stream.tick('1 second').pipe(
              Stream.drop(1),
              Stream.map(() => Message.cases.Tick.make({}))
            )
          : Stream.empty
    }
  ),
  demoDismiss: entry(
    { open: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ open: model.demoOpen }),
      dependenciesToStream: ({ open }) =>
        open
          ? dismissals('demo-credentials', Message.cases.DemoClosed.make({}))
          : Stream.empty
    }
  ),
  turnstile: entry(
    { siteKey: Schema.NullOr(Schema.String), revision: Schema.Number },
    {
      modelToDependencies: (model) => ({
        siteKey:
          model.ready && needsChallenge(model) ? model.flags.turnstileSiteKey : null,
        revision: model.challengeRevision
      }),
      dependenciesToStream: ({ siteKey }) =>
        siteKey === null
          ? Stream.empty
          : Stream.callback<Message>((queue) =>
              Effect.gen(function* () {
                let widget: string | undefined
                let active = true
                function emit(token: string | null) {
                  if (active) {
                    Queue.offerUnsafe(
                      queue,
                      Message.cases.ChangedChallenge.make({ token })
                    )
                  }
                }
                function mount() {
                  const container = document.getElementById('auth-turnstile')
                  if (!active || !container || !window.turnstile || siteKey === null) {
                    return
                  }
                  widget = window.turnstile.render(container, {
                    sitekey: siteKey,
                    theme: 'dark',
                    callback: emit,
                    'expired-callback': () => emit(null),
                    'error-callback': () => emit(null)
                  })
                }
                function failed() {
                  script.remove()
                  emit(null)
                }
                const existing = document.getElementById('cf-turnstile-script')
                const script = existing ?? document.createElement('script')
                if (window.turnstile) {
                  mount()
                } else {
                  script.addEventListener('load', mount, { once: true })
                  script.addEventListener('error', failed, { once: true })
                  if (script instanceof HTMLScriptElement && existing === null) {
                    script.id = 'cf-turnstile-script'
                    script.src =
                      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
                    script.async = true
                    // oxlint-disable-next-line unicorn/prefer-dom-node-append -- Cloudflare HTMLRewriter also declares head.append with a non-DOM signature.
                    document.head.appendChild(script)
                  }
                }
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    active = false
                    script.removeEventListener('load', mount)
                    script.removeEventListener('error', failed)
                    if (widget !== undefined) {
                      window.turnstile?.remove(widget)
                    }
                  })
                )
              })
            )
    }
  )
}))
