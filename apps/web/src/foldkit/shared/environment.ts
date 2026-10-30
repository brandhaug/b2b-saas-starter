import { Effect, Option, Queue, Schema, Stream } from 'effect'
import { Command, ManagedResource, Subscription, type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import {
  analyticsConsent,
  saveAnalyticsConsent,
  subscribeAnalyticsConsent
} from '@/lib/analytics-consent'
import { trackFormEdits } from '@/lib/unsaved-form'
import { setLocalePreferencesServerFn } from '@/lib/server/account-preferences'
import { buttonClass, link } from './view'

export const Flags = Schema.Struct({
  token: Schema.NullOr(Schema.String),
  authenticated: Schema.Boolean,
  needsTimeZone: Schema.Boolean
})
export type Flags = typeof Flags.Type
const Choice = Schema.Literals(['loading', 'pending', 'accepted', 'declined'])
export const Model = Schema.Struct({
  flags: Flags,
  ready: Schema.Boolean,
  choice: Choice,
  settingsOpen: Schema.Boolean,
  storageFailed: Schema.Boolean
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: { choice: Choice },
  Changed: { choice: Choice },
  Selected: { choice: Schema.Literals(['accepted', 'declined']) },
  Saved: { success: Schema.Boolean },
  SettingsOpened: {},
  Closed: {},
  Completed: {}
})
export type Message = typeof Message.Type
const Ready = Command.define('Environment.Ready', {
  args: { flags: Flags },
  messages: [Message.cases.Ready],
  execute: ({ flags }) =>
    Effect.sync(() =>
      Message.cases.Ready.make({
        choice: flags.token === null ? 'loading' : analyticsConsent()
      })
    )
})
const TimeZone = Command.define('Environment.TimeZone', {
  messages: [Message.cases.Completed],
  execute: Effect.tryPromise({
    try: () =>
      setLocalePreferencesServerFn({
        data: {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          initializeTimeZone: true
        }
      }),
    catch: () => Message.cases.Completed.make({})
  }).pipe(
    Effect.map(() => {
      document.documentElement.dataset.needsTimeZone = 'false'
      return Message.cases.Completed.make({})
    }),
    Effect.catch((error) => Effect.succeed(error))
  )
})
const Save = Command.define('Environment.SaveConsent', {
  args: { choice: Schema.Literals(['accepted', 'declined']) },
  messages: [Message.cases.Saved],
  execute: ({ choice }) =>
    Effect.sync(() =>
      Message.cases.Saved.make({ success: saveAnalyticsConsent(choice) })
    )
})
export function init(flags: Flags): Update.Return<Model, Message> {
  return {
    model: {
      flags,
      ready: false,
      choice: 'loading',
      settingsOpen: false,
      storageFailed: false
    },
    commands: [
      Ready({ flags }),
      ...(flags.authenticated && flags.needsTimeZone ? [TimeZone()] : [])
    ]
  }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Ready': {
      return { model: { ...model, ready: true, choice: message.choice } }
    }
    case 'Changed': {
      return { model: { ...model, choice: message.choice } }
    }
    case 'Selected': {
      return { model, commands: [Save({ choice: message.choice })] }
    }
    case 'Saved': {
      return { model: { ...model, storageFailed: !message.success } }
    }
    case 'SettingsOpened': {
      return { model: { ...model, settingsOpen: true } }
    }
    case 'Closed': {
      return { model: { ...model, settingsOpen: false } }
    }
    case 'Completed': {
      return { model }
    }
  }
}
const DocumentEvents = ManagedResource.tag<() => void>()('Environment.DocumentEvents')
const Beacon = ManagedResource.tag<HTMLScriptElement>()('Environment.Beacon')
function record(event: Event): void {
  document.documentElement.dataset.inputModality =
    event.type === 'keydown' ? 'keyboard' : 'pointer'
}
export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  documentEvents: entry(Schema.Option(Schema.Null), {
    resource: DocumentEvents,
    modelToMaybeRequirements: (model) =>
      model.ready ? Option.some(null) : Option.none(),
    acquire: () =>
      Effect.sync(() => {
        const stopTracking = trackFormEdits()
        document.addEventListener('keydown', record, true)
        document.addEventListener('pointerdown', record, true)
        return () => {
          stopTracking()
          document.removeEventListener('keydown', record, true)
          document.removeEventListener('pointerdown', record, true)
          document.documentElement.removeAttribute('data-input-modality')
        }
      }),
    release: (dispose) => Effect.sync(dispose),
    onAcquired: () => Message.cases.Completed.make({}),
    onReleased: () => Message.cases.Completed.make({}),
    onAcquireError: () => Message.cases.Completed.make({})
  }),
  beacon: entry(Schema.Option(Schema.String), {
    resource: Beacon,
    modelToMaybeRequirements: (model) =>
      model.ready && model.choice === 'accepted' && !model.storageFailed
        ? Option.fromNullishOr(model.flags.token)
        : Option.none(),
    acquire: (token) =>
      Effect.sync(() => {
        const script = document.createElement('script')
        script.async = true
        script.src = 'https://static.cloudflareinsights.com/beacon.min.js'
        script.dataset.cfBeacon = JSON.stringify({ token })
        // oxlint-disable-next-line unicorn/prefer-dom-node-append -- Cloudflare's Element.append overload is not the browser Node method.
        document.head.appendChild(script)
        return script
      }),
    release: (script) => Effect.sync(() => script.remove()),
    onAcquired: () => Message.cases.Completed.make({}),
    onReleased: () => Message.cases.Completed.make({}),
    onAcquireError: () => Message.cases.Completed.make({})
  })
}))
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  consentChanges: entry(
    { active: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        active: model.ready && model.flags.token !== null
      }),
      dependenciesToStream: ({ active }) =>
        active
          ? Stream.callback<Message>((queue) =>
              Effect.gen(function* () {
                const dispose = subscribeAnalyticsConsent(() =>
                  Queue.offerUnsafe(
                    queue,
                    Message.cases.Changed.make({ choice: analyticsConsent() })
                  )
                )
                yield* Effect.addFinalizer(() => Effect.sync(dispose))
              })
            )
          : Stream.empty
    }
  )
}))
export function view(model: Model, h: HtmlBuilder<Message>): Html {
  if (model.flags.token === null || model.choice === 'loading') {
    return h.div([])
  }
  if (model.choice !== 'pending' && !model.settingsOpen && !model.storageFailed) {
    return h.div(
      [h.Class('fixed bottom-3 left-3 z-40')],
      [
        h.button(
          [
            h.Type('button'),
            h.Class(buttonClass),
            h.OnClick(Message.cases.SettingsOpened.make({}))
          ],
          [m.analytics_consent_settings()]
        )
      ]
    )
  }
  return h.section(
    [
      h.Attribute('aria-labelledby', 'analytics-consent-title'),
      h.Class(
        'fixed inset-x-0 bottom-0 z-50 max-h-dvh overflow-y-auto border-t border-border bg-card px-4 py-5 sm:px-6'
      )
    ],
    [
      h.div(
        [
          h.Class(
            'mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'
          )
        ],
        [
          h.div(
            [h.Class('flex max-w-prose flex-col gap-2')],
            [
              h.h2(
                [h.Id('analytics-consent-title'), h.Class('text-base font-semibold')],
                [m.analytics_consent_title()]
              ),
              h.p(
                [h.Class('text-sm text-muted-foreground')],
                [m.analytics_consent_description()]
              ),
              h.p(
                [h.Class('text-sm text-muted-foreground')],
                [
                  m.analytics_consent_choice_notice(),
                  ' ',
                  link(h, '/privacy', m.privacy())
                ]
              ),
              model.storageFailed
                ? h.p(
                    [h.Role('alert'), h.Class('text-sm text-destructive')],
                    [m.analytics_consent_storage_failed()]
                  )
                : null
            ]
          ),
          h.div(
            [h.Class('flex shrink-0 flex-wrap gap-2')],
            [
              h.button(
                [
                  h.Type('button'),
                  h.Class(buttonClass),
                  h.OnClick(Message.cases.Selected.make({ choice: 'declined' }))
                ],
                [m.analytics_consent_decline()]
              ),
              h.button(
                [
                  h.Type('button'),
                  h.Class(buttonClass),
                  h.OnClick(Message.cases.Selected.make({ choice: 'accepted' }))
                ],
                [m.analytics_consent_allow()]
              ),
              model.choice !== 'pending' && !model.storageFailed
                ? h.button(
                    [
                      h.Type('button'),
                      h.Class(buttonClass),
                      h.OnClick(Message.cases.Closed.make({}))
                    ],
                    [m.common_close()]
                  )
                : null
            ]
          )
        ]
      )
    ]
  )
}
