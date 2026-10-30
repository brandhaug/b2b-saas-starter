import { Effect, Option, Schema, Stream } from 'effect'
import { Command, ManagedResource, Subscription, Render, type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import { localizeHref, setLocale } from '@b2b-saas-starter/i18n/runtime'
import { GITHUB_URL } from '@/lib/github-url'
import { hasEditedForms } from '@/lib/unsaved-form'
import { setLocalePreferencesServerFn } from '@/lib/server/account-preferences'
import { DocMeta, docPath } from '../docs/contracts'
import { call } from '../server-call'
import {
  buttonClass,
  primaryButtonClass,
  inputClass,
  icon,
  link,
  localeFlag
} from './view'

export const Flags = Schema.Struct({
  signedIn: Schema.Boolean,
  locale: Schema.Literals(['en', 'nb']),
  docs: Schema.Array(DocMeta),
  commands: Schema.optional(
    Schema.Array(
      Schema.Struct({
        href: Schema.String,
        label: Schema.String,
        keywords: Schema.String
      })
    )
  ),
  path: Schema.String
})
export type Flags = typeof Flags.Type
export const Model = Schema.Struct({
  flags: Flags,
  ready: Schema.Boolean,
  dialog: Schema.NullOr(Schema.Literals(['menu', 'search', 'locale'])),
  query: Schema.String,
  selected: Schema.Number,
  localeTarget: Schema.NullOr(Schema.Literals(['en', 'nb'])),
  saving: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  mac: Schema.Boolean
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: { mac: Schema.Boolean },
  Opened: { dialog: Schema.Literals(['menu', 'search']) },
  Closed: {},
  QueryChanged: { query: Schema.String },
  Moved: { delta: Schema.Number },
  Activated: {},
  LocaleSelected: { locale: Schema.Literals(['en', 'nb']) },
  LocaleChecked: { locale: Schema.Literals(['en', 'nb']), dirty: Schema.Boolean },
  LocaleConfirmed: {},
  Failed: { error: Schema.String },
  Completed: {}
})
export type Message = typeof Message.Type
const Ready = Command.define('PublicShell.Ready', {
  messages: [Message.cases.Ready],
  execute: Effect.sync(() =>
    Message.cases.Ready.make({ mac: navigator.platform.toUpperCase().includes('MAC') })
  )
})
const CheckLocale = Command.define('PublicShell.CheckLocale', {
  args: { locale: Schema.Literals(['en', 'nb']) },
  messages: [Message.cases.LocaleChecked],
  execute: ({ locale }) =>
    Effect.sync(() =>
      Message.cases.LocaleChecked.make({ locale, dirty: hasEditedForms() })
    )
})
const ChangeLocale = Command.define('PublicShell.ChangeLocale', {
  args: { locale: Schema.Literals(['en', 'nb']), signedIn: Schema.Boolean },
  messages: [Message.cases.Completed, Message.cases.Failed],
  execute: ({ locale, signedIn }) =>
    Effect.gen(function* () {
      if (signedIn) {
        yield* call(
          () => setLocalePreferencesServerFn({ data: { locale } }),
          m.shell_save_error()
        )
      }
      yield* Effect.promise(async () => {
        await setLocale(locale)
      })
      return Message.cases.Completed.make({})
    }).pipe(
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Message.cases.Failed.make({ error: error.message }))
      )
    )
})
const Navigate = Command.define('PublicShell.Navigate', {
  args: { href: Schema.String },
  messages: [Message.cases.Completed],
  execute: ({ href }) =>
    Effect.sync(() => {
      window.location.assign(localizeHref(href))
      return Message.cases.Completed.make({})
    })
})

export function init(flags: Flags): Update.Return<Model, Message> {
  return {
    model: {
      flags,
      ready: false,
      dialog: null,
      query: '',
      selected: 0,
      localeTarget: null,
      saving: false,
      error: null,
      mac: true
    },
    commands: [Ready()]
  }
}
export function navigation() {
  return [
    { href: '/docs', label: m.docs() },
    { href: '/pricing', label: m.public_meta_pricing() },
    { href: '/help', label: m.public_meta_support() }
  ]
}
function entries(model: Model) {
  const members = model.flags.commands?.find((row) => row.href.endsWith('/members'))
  const query = model.query.trim()
  const rows = [
    ...(members && query
      ? [
          {
            href: `${members.href}?query=${encodeURIComponent(query)}`,
            label: m.workspace_find_members({ query }),
            keywords: query
          }
        ]
      : []),
    ...(model.flags.commands ?? [
      { href: '/workspaces', label: m.open_workspaces(), keywords: '' },
      { href: '/account', label: m.nav_account(), keywords: '' }
    ]),
    ...model.flags.docs.map((doc) => ({
      href: docPath(doc),
      label: doc.frontmatter.title,
      keywords: `${doc.frontmatter.description} ${doc.category}`
    })),
    {
      href: `/docs/search?q=${encodeURIComponent(model.query)}`,
      label: m.docs_search_title(),
      keywords: model.query
    },
    ...navigation().map((row) => ({ href: row.href, label: row.label, keywords: '' }))
  ]
  const terms = model.query.toLowerCase().trim().split(/\s+/)
  return rows.filter((row) =>
    terms.every((term) => `${row.label} ${row.keywords}`.toLowerCase().includes(term))
  )
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Ready': {
      return { model: { ...model, ready: true, mac: message.mac } }
    }
    case 'Opened': {
      return { model: { ...model, dialog: message.dialog, query: '', selected: 0 } }
    }
    case 'Closed': {
      return { model: { ...model, dialog: null, localeTarget: null } }
    }
    case 'QueryChanged': {
      return { model: { ...model, query: message.query, selected: 0 } }
    }
    case 'Moved': {
      return {
        model: {
          ...model,
          selected: Math.max(
            0,
            Math.min(entries(model).length - 1, model.selected + message.delta)
          )
        }
      }
    }
    case 'Activated': {
      const row = entries(model)[model.selected]
      return row ? { model, commands: [Navigate({ href: row.href })] } : { model }
    }
    case 'LocaleSelected': {
      return model.saving || message.locale === model.flags.locale
        ? { model }
        : { model, commands: [CheckLocale({ locale: message.locale })] }
    }
    case 'LocaleChecked': {
      const next = { ...model, localeTarget: message.locale, dialog: 'locale' as const }
      return message.dirty
        ? { model: next }
        : update(next, Message.cases.LocaleConfirmed.make({}))
    }
    case 'LocaleConfirmed': {
      return model.localeTarget === null || model.saving
        ? { model }
        : {
            model: { ...model, saving: true, dialog: null, error: null },
            commands: [
              ChangeLocale({
                locale: model.localeTarget,
                signedIn: model.flags.signedIn
              })
            ]
          }
    }
    case 'Failed': {
      return { model: { ...model, saving: false, error: message.error } }
    }
    case 'Completed': {
      return { model }
    }
  }
}

const Dialog = ManagedResource.tag<HTMLDialogElement>()('PublicShell.Dialog')
export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  dialog: entry(Schema.Option(Schema.String), {
    resource: Dialog,
    modelToMaybeRequirements: (model) =>
      model.ready && model.dialog !== null
        ? Option.some(`public-${model.dialog}`)
        : Option.none(),
    acquire: (id) =>
      Render.afterCommit.pipe(
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
      ),
    release: (dialog) => Effect.sync(() => dialog.close()),
    onAcquired: () => Message.cases.Completed.make({}),
    onReleased: () => Message.cases.Completed.make({}),
    onAcquireError: () => Message.cases.Closed.make({})
  })
}))
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  keys: entry(
    { ready: Schema.Boolean, dialog: Schema.NullOr(Schema.String) },
    {
      modelToDependencies: (model) => ({
        ready: model.ready,
        dialog: model.dialog
      }),
      dependenciesToStream: ({ ready, dialog }) =>
        ready
          ? Stream.fromEventListener<KeyboardEvent>(document, 'keydown').pipe(
              Stream.filter(
                (event) =>
                  ((event.metaKey || event.ctrlKey) &&
                    event.key.toLowerCase() === 'k') ||
                  (dialog !== null && event.key === 'Escape')
              ),
              Stream.map((event) => {
                event.preventDefault()
                return event.key === 'Escape' || dialog === 'search'
                  ? Message.cases.Closed.make({})
                  : Message.cases.Opened.make({ dialog: 'search' })
              })
            )
          : Stream.empty
    }
  ),
  dismiss: entry(
    { dialog: Schema.NullOr(Schema.String) },
    {
      modelToDependencies: (model) => ({ dialog: model.dialog }),
      dependenciesToStream: ({ dialog }) =>
        dialog === null
          ? Stream.empty
          : Stream.unwrap(
              Effect.sync(() => {
                const element = document.getElementById(`public-${dialog}`)
                return element
                  ? Stream.fromEventListener<Event>(element, 'cancel').pipe(
                      Stream.map((event) => {
                        event.preventDefault()
                        return Message.cases.Closed.make({})
                      })
                    )
                  : Stream.empty
              })
            )
    }
  )
}))

type H = HtmlBuilder<Message>
export function localePicker(model: Model, h: H, id: string): Html {
  return h.div(
    [h.Class('relative inline-flex shrink-0')],
    [
      localeFlag(h, model.flags.locale),
      h.select(
        [
          h.Id(id),
          h.AriaLabel(m.shell_language()),
          h.Class(
            'h-11 w-32 rounded-md border border-input bg-input/30 pl-10 pr-2 text-sm focus-visible:outline-2 focus-visible:outline-ring md:h-9'
          ),
          h.Value(model.flags.locale),
          h.Disabled(!model.ready || model.saving),
          h.OnChange((locale) =>
            locale === 'en' || locale === 'nb'
              ? Message.cases.LocaleSelected.make({ locale })
              : Message.cases.Completed.make({})
          )
        ],
        [h.option([h.Value('en')], ['English']), h.option([h.Value('nb')], ['Norsk'])]
      )
    ]
  )
}
export function searchButton(model: Model, h: H): Html {
  return h.button(
    [
      h.Type('button'),
      h.Class(`${buttonClass} gap-2 text-muted-foreground md:w-56`),
      h.AriaLabel(m.common_search()),
      h.Disabled(!model.ready),
      h.OnClick(Message.cases.Opened.make({ dialog: 'search' }))
    ],
    [
      icon(h, 'search'),
      h.span(
        [h.Class('hidden flex-1 text-left md:inline')],
        [m.common_search_placeholder()]
      ),
      h.kbd(
        [
          h.Class(
            'hidden rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs md:inline'
          )
        ],
        [model.mac ? '⌘K' : 'Ctrl K']
      )
    ]
  )
}
function closeButton(h: H): Html {
  return h.button(
    [
      h.Type('button'),
      h.Class(`${buttonClass} ml-auto`),
      h.AriaLabel(m.shell_cancel()),
      h.OnClick(Message.cases.Closed.make({}))
    ],
    [icon(h, 'close')]
  )
}

export function view(model: Model, h: H, body: Html): Html {
  function account() {
    return link(
      h,
      model.flags.signedIn ? '/workspaces' : '/sign-in',
      model.flags.signedIn ? m.common_workspaces() : m.form_sign_in(),
      `${primaryButtonClass} shrink-0 max-md:ml-auto`
    )
  }
  function nav() {
    return navigation().map((row) =>
      link(
        h,
        row.href,
        row.label,
        'min-h-11 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground'
      )
    )
  }
  return h.div(
    [h.Class('marketing flex min-h-dvh flex-col bg-background')],
    [
      link(
        h,
        '#main-content',
        m.common_skip_to_content(),
        'sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary px-3 py-2 text-sm focus:text-primary-foreground'
      ),
      h.header(
        [h.Class('sticky top-0 z-40 border-b border-border bg-background')],
        [
          h.div(
            [
              h.Class(
                'mx-auto flex h-16 min-w-0 max-w-7xl items-center gap-2 px-4 sm:px-6 md:gap-4'
              )
            ],
            [
              h.button(
                [
                  h.Type('button'),
                  h.Id('public-menu-trigger'),
                  h.Class(`${buttonClass} xl:hidden`),
                  h.AriaLabel(m.common_open_menu()),
                  h.Disabled(!model.ready),
                  h.OnClick(Message.cases.Opened.make({ dialog: 'menu' }))
                ],
                [icon(h, 'menu')]
              ),
              h.a(
                [
                  h.Href('/'),
                  h.Class('flex items-center gap-2 font-semibold whitespace-nowrap')
                ],
                [
                  h.img([
                    h.Src('/assets/starter-logo.png'),
                    h.Alt(''),
                    h.Width('40'),
                    h.Height('40'),
                    h.Class('size-10 shrink-0')
                  ]),
                  h.span(
                    [h.Class('sr-only sm:not-sr-only sm:whitespace-nowrap')],
                    ['B2B SaaS Starter']
                  )
                ]
              ),
              h.nav(
                [
                  h.AriaLabel(m.common_site_navigation()),
                  h.Class('ml-auto hidden items-center gap-1 xl:flex')
                ],
                nav()
              ),
              h.div(
                [h.Class('ml-auto hidden shrink-0 md:block xl:ml-0')],
                [searchButton(model, h)]
              ),
              h.div(
                [h.Class('hidden xl:block')],
                [localePicker(model, h, 'public-locale-desktop')]
              ),
              account()
            ]
          )
        ]
      ),
      model.error
        ? h.p(
            [h.Role('alert'), h.Class('px-4 py-2 text-sm text-destructive')],
            [model.error]
          )
        : null,
      body,
      h.footer(
        [h.Class('mt-auto border-t border-border')],
        [
          h.div(
            [
              h.Class(
                'mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between'
              )
            ],
            [
              h.span([], [m.site_footer_tagline()]),
              h.div(
                [h.Class('flex flex-wrap gap-4')],
                [
                  link(h, '/privacy', m.privacy()),
                  link(h, '/terms', m.terms()),
                  h.a(
                    [
                      h.Href(`${GITHUB_URL}/releases`),
                      h.Target('_blank'),
                      h.Rel('noopener noreferrer'),
                      h.Class(
                        'inline-flex min-h-11 items-center py-3 underline-offset-4 hover:text-foreground hover:underline'
                      )
                    ],
                    [
                      m.changelog(),
                      h.span([h.Class('sr-only')], [m.common_opens_new_tab()])
                    ]
                  )
                ]
              )
            ]
          )
        ]
      ),
      ...overlays(
        model,
        h,
        h.nav(
          [
            h.AriaLabel(m.common_site_navigation()),
            h.Class('flex max-h-[80dvh] flex-col gap-2 overflow-y-auto py-4')
          ],
          [
            ...nav(),
            searchButton(model, h),
            localePicker(model, h, 'public-locale-mobile'),
            account()
          ]
        )
      )
    ]
  )
}

export function overlays(model: Model, h: H, menu: Html): ReadonlyArray<Html> {
  const results = entries(model)
  return [
    h.dialog(
      [
        h.Id('public-menu'),
        h.Attribute('aria-labelledby', 'public-menu-title'),
        h.Class(
          'fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-80 max-w-[90vw] border-r border-border bg-background p-4 text-foreground backdrop:bg-black/50'
        )
      ],
      [
        h.div(
          [h.Class('flex items-center gap-2')],
          [
            h.h2(
              [h.Id('public-menu-title'), h.Class('text-lg font-semibold')],
              [m.common_menu()]
            ),
            closeButton(h)
          ]
        ),
        menu
      ]
    ),
    h.dialog(
      [
        h.Id('public-search'),
        h.Attribute('aria-label', m.shell_command_menu()),
        h.Class(
          'm-auto max-h-[calc(100dvh-2rem)] w-[min(36rem,95vw)] overflow-y-auto rounded-lg border border-border bg-popover p-4 text-popover-foreground backdrop:bg-black/50'
        )
      ],
      [
        h.div(
          [h.Class('flex items-center gap-2')],
          [
            h.input([
              h.Type('search'),
              h.Role('combobox'),
              h.Attribute('aria-autocomplete', 'list'),
              h.Attribute('aria-expanded', String(model.dialog === 'search')),
              h.Attribute('aria-controls', 'public-search-results'),
              ...(results[model.selected]
                ? [
                    h.Attribute(
                      'aria-activedescendant',
                      `public-search-option-${model.selected}`
                    )
                  ]
                : []),
              h.Class(inputClass),
              h.AriaLabel(m.command_search_label()),
              h.Placeholder(m.command_search_placeholder()),
              h.Value(model.query),
              h.Attribute('autofocus', ''),
              h.OnInput((query) => Message.cases.QueryChanged.make({ query })),
              h.OnKeyDownPreventDefault((key) => {
                if (key === 'ArrowDown') {
                  return Option.some(Message.cases.Moved.make({ delta: 1 }))
                }
                if (key === 'ArrowUp') {
                  return Option.some(Message.cases.Moved.make({ delta: -1 }))
                }
                if (key === 'Enter') {
                  return Option.some(Message.cases.Activated.make({}))
                }
                return Option.none()
              })
            ]),
            closeButton(h)
          ]
        ),
        h.ul(
          [
            h.Id('public-search-results'),
            h.Role('listbox'),
            h.Class('mt-3 max-h-80 overflow-y-auto'),
            h.AriaLabel(m.common_search())
          ],
          results.length
            ? results.map((row, index) =>
                h.li(
                  [h.Role('presentation')],
                  [
                    h.a(
                      [
                        h.Id(`public-search-option-${index}`),
                        h.Role('option'),
                        h.Tabindex(-1),
                        h.Attribute('aria-selected', String(index === model.selected)),
                        h.Href(localizeHref(row.href)),
                        h.Class(
                          `block rounded-md px-3 py-2 text-sm hover:bg-accent ${index === model.selected ? 'bg-accent' : ''}`
                        )
                      ],
                      [row.label]
                    )
                  ]
                )
              )
            : [h.li([h.Class('py-6 text-center text-sm')], [m.command_no_results()])]
        )
      ]
    ),
    h.dialog(
      [
        h.Id('public-locale'),
        h.Role('alertdialog'),
        h.Attribute('aria-labelledby', 'public-locale-title'),
        h.Attribute('aria-describedby', 'public-locale-description'),
        h.Class(
          'm-auto max-w-md rounded-lg border border-border bg-background p-6 text-foreground backdrop:bg-black/50'
        )
      ],
      [
        h.h2(
          [h.Id('public-locale-title'), h.Class('text-lg font-semibold')],
          [m.shell_unsaved_title()]
        ),
        h.p(
          [
            h.Id('public-locale-description'),
            h.Class('my-4 text-sm text-muted-foreground')
          ],
          [m.shell_unsaved_description()]
        ),
        h.div(
          [h.Class('flex justify-end gap-2')],
          [
            h.button(
              [
                h.Type('button'),
                h.Class(buttonClass),
                h.OnClick(Message.cases.Closed.make({}))
              ],
              [m.shell_cancel()]
            ),
            h.button(
              [
                h.Type('button'),
                h.Class(buttonClass),
                h.OnClick(Message.cases.LocaleConfirmed.make({}))
              ],
              [m.shell_switch()]
            )
          ]
        )
      ]
    )
  ]
}
