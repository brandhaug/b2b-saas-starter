import { Effect, Option, Queue, Schema, Stream } from 'effect'
import { Command, ManagedResource, Subscription, type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import { localizeHref } from '@b2b-saas-starter/i18n/runtime'
import { loadDemoShowcaseServerFnResponse } from '@/http/contracts/demo-showcase'
import { seedWorkspaceRecord } from '@b2b-saas-starter/capabilities/governance/workspace-identity.seed'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { GITHUB_URL } from '@/lib/github-url'
import {
  COPY_COMMAND,
  CLONE_COMMAND,
  REPOSITORY_DIRECTORY,
  SETUP_STEPS,
  DEPLOY_COMMAND,
  DEV_SERVERS
} from '@/lib/toolchain'
import {
  CALL_SITES,
  CAPABILITY_SNIPPET,
  CONTRACT_SNIPPET
} from '@/components/landing/request-trace-snippets'
import { DocMeta, docPath } from '../docs/contracts'
import { architecture } from './architecture'
import { buttonClass, primaryButtonClass, icon, link } from '../shared/view'
import { mountLightRays } from '../light-rays'

export const Flags = Schema.Struct({
  demo: loadDemoShowcaseServerFnResponse,
  recentDocs: Schema.Array(DocMeta)
})
export type Flags = typeof Flags.Type
const Stage = Schema.Literals(['request', 'contract', 'capability', 'runtime'])
export const Model = Schema.Struct({
  flags: Flags,
  stage: Stage,
  openFaq: Schema.NullOr(Schema.Number),
  copied: Schema.Literals(['idle', 'copied', 'failed']),
  ready: Schema.Boolean
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: {},
  SelectedStage: { stage: Stage },
  ToggledFaq: { index: Schema.Number },
  CopyRequested: {},
  Copied: { success: Schema.Boolean },
  ResetCopy: {},
  Completed: {}
})
export type Message = typeof Message.Type
const Ready = Command.define('Home.Ready', {
  messages: [Message.cases.Ready],
  execute: Effect.succeed(Message.cases.Ready.make({}))
})
const Copy = Command.define('Home.Copy', {
  messages: [Message.cases.Copied],
  execute: Effect.tryPromise({
    try: () => navigator.clipboard.writeText(COPY_COMMAND),
    catch: () => Message.cases.Copied.make({ success: false })
  }).pipe(
    Effect.map(() => Message.cases.Copied.make({ success: true })),
    Effect.catch((error) => Effect.succeed(error))
  )
})
export function init(flags: Flags): Update.Return<Model, Message> {
  return {
    model: { flags, stage: 'request', openFaq: 0, copied: 'idle', ready: false },
    commands: [Ready()]
  }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'ToggledFaq': {
      return {
        model: {
          ...model,
          openFaq: model.openFaq === message.index ? null : message.index
        }
      }
    }
    case 'Ready': {
      return { model: { ...model, ready: true } }
    }
    case 'SelectedStage': {
      return { model: { ...model, stage: message.stage } }
    }
    case 'CopyRequested': {
      return { model, commands: [Copy()] }
    }
    case 'Copied': {
      return { model: { ...model, copied: message.success ? 'copied' : 'failed' } }
    }
    case 'ResetCopy': {
      return { model: { ...model, copied: 'idle' } }
    }
    case 'Completed': {
      return { model }
    }
  }
}
const isStage = Schema.is(Stage)
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  copyReset: entry(
    { status: Schema.String },
    {
      modelToDependencies: (model) => ({ status: model.copied }),
      dependenciesToStream: ({ status }) =>
        status === 'idle'
          ? Stream.empty
          : Stream.fromEffect(
              Effect.sleep('2 seconds').pipe(
                Effect.as(Message.cases.ResetCopy.make({}))
              )
            )
    }
  ),
  trace: entry(
    { ready: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ ready: model.ready }),
      dependenciesToStream: ({ ready }) =>
        ready
          ? Stream.callback<Message>((queue) =>
              Effect.gen(function* () {
                const observer = new IntersectionObserver(
                  (entries) => {
                    for (const observed of entries) {
                      const stage = observed.target.getAttribute('data-stage')
                      if (observed.isIntersecting && isStage(stage)) {
                        Queue.offerUnsafe(
                          queue,
                          Message.cases.SelectedStage.make({ stage })
                        )
                      }
                    }
                  },
                  { rootMargin: '-25% 0px -65% 0px' }
                )
                for (const element of document.querySelectorAll(
                  '#request-trace [data-stage]'
                )) {
                  observer.observe(element)
                }
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => observer.disconnect())
                )
              })
            )
          : Stream.empty
    }
  )
}))
const Rays = ManagedResource.tag<ReadonlyArray<() => void>>()('Home.Rays')
export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  rays: entry(Schema.Option(Schema.Null), {
    resource: Rays,
    modelToMaybeRequirements: (model) =>
      model.ready ? Option.some(null) : Option.none(),
    acquire: () =>
      Effect.sync(() =>
        [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-home-rays]')].map(
          mountLightRays
        )
      ),
    release: (disposals) =>
      Effect.sync(() => {
        for (const dispose of disposals) {
          dispose()
        }
      }),
    onAcquired: () => Message.cases.Completed.make({}),
    onReleased: () => Message.cases.Completed.make({}),
    onAcquireError: () => Message.cases.Completed.make({})
  })
}))
type H = HtmlBuilder<Message>
const headingClass =
  'font-display text-balance text-3xl font-medium leading-display sm:text-4xl'
const sectionClass =
  'mx-auto grid max-w-7xl gap-8 px-5 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16'
const stageNodes = {
  request: ['curl'],
  contract: ['api'],
  capability: ['web', 'api', 'capabilities'],
  runtime: ['web', 'api', 'background', 'd1', 'durable-objects', 'queues', 'email']
}

function rays(h: H, origin: 'top' | 'bottom' = 'bottom'): Html {
  return h.canvas([
    h.Attribute('data-home-rays', ''),
    h.Attribute('aria-hidden', 'true'),
    h.Class(
      `pointer-events-none absolute inset-0 size-full text-primary opacity-30 ${origin === 'bottom' ? 'rotate-180' : ''}`
    )
  ])
}
function snippet(h: H, label: string, code: string, path?: string): Html {
  const tokens = code.split(
    /(\/\/[^\n]*|#[^\n]*|`[^`]*`|'[^'\n]*'|"[^"\n]*"|\b\d+(?:\.\d+)?\b|\b[A-Z][A-Z0-9_]+\b|\b(?:export|const|let|return|yield|function|async|await|new|type|readonly)\b|\b[a-zA-Z_$][\w$]*(?=\s*\()|[{}()[\].,:;<>])/g
  )
  return h.figure(
    [h.Class('min-w-0 border border-border bg-card')],
    [
      h.figcaption(
        [
          h.Class(
            'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3 font-mono text-xs text-muted-foreground sm:px-5'
          )
        ],
        [
          h.span([h.Class('break-words')], [label]),
          path
            ? h.a(
                [
                  h.Href(`${GITHUB_URL}/blob/master/${path}`),
                  h.Target('_blank'),
                  h.Rel('noopener noreferrer'),
                  h.Class(
                    'min-w-0 break-all py-1 text-sm underline underline-offset-4 hover:text-foreground max-md:min-h-11 max-md:content-center'
                  )
                ],
                [path, h.span([h.Class('sr-only')], [m.common_opens_new_tab()])]
              )
            : null
        ]
      ),
      h.pre(
        [
          h.Role('region'),
          h.AriaLabel(m.showcase_scrollable_code({ label })),
          h.Tabindex(0),
          h.Class(
            'max-h-120 overflow-auto p-4 font-mono text-xs leading-relaxed text-foreground sm:p-5 sm:text-sm'
          )
        ],
        [
          h.code(
            [h.Attribute('data-code-theme', '')],
            tokens.map((token) => {
              const kind = tokenKind(token)
              return h.span([h.Class(`code-token-${kind}`)], [token])
            })
          )
        ]
      )
    ]
  )
}
function copyStatus(model: Model): string {
  if (model.copied === 'copied') {
    return m.action_copied()
  }
  if (model.copied === 'failed') {
    return m.action_copy_commands_failed()
  }
  return ''
}
function tokenKind(token: string): string {
  if (/^(\/\/|#)/.test(token)) {
    return 'comment'
  }
  if (/^[`'"]/.test(token)) {
    return 'string'
  }
  if (/^\d/.test(token)) {
    return 'number'
  }
  if (/^[A-Z][A-Z0-9_]+$/.test(token)) {
    return 'constant'
  }
  if (
    /^(export|const|let|return|yield|function|async|await|new|type|readonly)$/.test(
      token
    )
  ) {
    return 'keyword'
  }
  if (/^[a-zA-Z_$][\w$]*$/.test(token)) {
    return 'function'
  }
  if (/^[{}()[\].,:;<>]$/.test(token)) {
    return 'punctuation'
  }
  return 'plain'
}

function trace(model: Model, h: H): Html {
  const overview = model.flags.demo?.overview ?? {
    workspace: seedWorkspaceRecord,
    notifications: []
  }
  const first = overview.notifications[0]
  const remaining = overview.notifications.length - (first ? 1 : 0)
  const response =
    JSON.stringify(
      { workspace: overview.workspace, notifications: first ? [first] : [] },
      null,
      2
    ) +
    (remaining > 0
      ? `\n${m.public_request_more_notifications({ count: remaining })}`
      : '')
  const stages = [
    {
      id: 'request',
      label: m.showcase_trace_request(),
      title: m.public_request_stage_request(),
      description: m.public_request_stage_request_description()
    },
    {
      id: 'contract',
      label: m.showcase_trace_contract(),
      title: m.public_request_stage_contract(),
      description: m.public_request_stage_contract_description()
    },
    {
      id: 'capability',
      label: m.showcase_trace_capability(),
      title: m.public_request_stage_capability(),
      description: m.public_request_stage_capability_description()
    },
    {
      id: 'runtime',
      label: m.showcase_trace_runtime(),
      title: m.public_request_stage_runtime(),
      description: m.public_runtime_description()
    }
  ] as const
  const rows = [
    {
      node: 'Workers',
      holds: m.showcase_workers_role(),
      declared: 'apps/web · apps/api · apps/background'
    },
    { node: 'D1', holds: m.public_request_d1_holds(), declared: 'packages/db' },
    {
      node: 'Durable Objects',
      holds: m.public_request_do_holds(),
      declared: 'apps/web · WorkspaceAssistantConversation'
    },
    {
      node: 'Queues',
      holds: m.public_request_queues_holds(),
      declared: 'apps/background'
    },
    { node: 'Email', holds: m.public_request_email_holds(), declared: 'packages/email' }
  ]
  const bodies = {
    request: [
      snippet(
        h,
        'REST · GET /workspaces/:slug/overview',
        `curl -H "Authorization: Bearer $API_TOKEN" \\\n  https://api.example.com/workspaces/${DEMO_WORKSPACE_SLUG}/overview\n\n${response}`
      ),
      h.p(
        [h.Class('mt-3 text-sm leading-relaxed text-muted-foreground')],
        [
          model.flags.demo === null
            ? m.showcase_trace_fixture_note()
            : m.showcase_trace_response_note()
        ]
      )
    ],
    contract: [
      snippet(
        h,
        m.shell_trace_workspace_group(),
        CONTRACT_SNIPPET.code,
        CONTRACT_SNIPPET.path
      )
    ],
    capability: [
      snippet(
        h,
        m.shell_trace_overview(),
        CAPABILITY_SNIPPET.code,
        CAPABILITY_SNIPPET.path
      ),
      h.details(
        [h.Class('group mt-4 border-b border-border')],
        [
          h.summary(
            [
              h.Class(
                'flex min-h-11 cursor-pointer items-center justify-between gap-4 py-4 text-sm font-medium'
              )
            ],
            [m.showcase_trace_compare_callers(), icon(h, 'chevron')]
          ),
          h.div(
            [h.Class('grid gap-4 pb-6')],
            CALL_SITES.map((site) => snippet(h, site.label, site.code, site.path))
          )
        ]
      )
    ],
    runtime: [
      h.dl(
        [h.Class('mt-8 border-t border-border')],
        rows.map((row) =>
          h.div(
            [
              h.Class(
                'grid gap-2 border-b border-border py-5 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-6'
              )
            ],
            [
              h.dt([h.Class('font-mono text-sm font-medium text-signal')], [row.node]),
              h.dd(
                [],
                [
                  h.p([h.Class('text-sm leading-relaxed')], [row.holds]),
                  h.p(
                    [h.Class('mt-2 font-mono text-xs text-muted-foreground')],
                    [row.declared]
                  )
                ]
              )
            ]
          )
        )
      ),
      h.p(
        [h.Class('mt-5 text-sm text-muted-foreground')],
        [h.code([h.Class('font-mono text-foreground')], [DEPLOY_COMMAND])]
      )
    ]
  }
  return h.section(
    [
      h.Id('request-trace'),
      h.Attribute('aria-labelledby', 'request-trace-heading'),
      h.Class('border-t border-border')
    ],
    [
      h.div(
        [h.Class('mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-24')],
        [
          h.div(
            [h.Class('max-w-3xl')],
            [
              h.h2(
                [
                  h.Id('request-trace-heading'),
                  h.Class(
                    'font-display text-4xl font-medium leading-display sm:text-5xl'
                  )
                ],
                [m.public_request_heading()]
              ),
              h.p(
                [
                  h.Class(
                    'mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground'
                  )
                ],
                [m.public_request_description()]
              )
            ]
          ),
          h.div(
            [
              h.Class(
                'mt-12 grid items-start gap-12 lg:mt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16'
              )
            ],
            [
              h.div(
                [h.Class('lg:sticky lg:top-24')],
                [
                  h.nav(
                    [h.AriaLabel(m.showcase_trace_navigation())],
                    [
                      h.ol(
                        [h.Class('grid grid-cols-2 gap-x-4 lg:grid-cols-1')],
                        stages.map((stage, index) =>
                          h.li(
                            [],
                            [
                              h.a(
                                [
                                  h.Href(`#request-${stage.id}`),
                                  ...(model.stage === stage.id
                                    ? [h.Attribute('aria-current', 'step')]
                                    : []),
                                  h.OnClick(
                                    Message.cases.SelectedStage.make({
                                      stage: stage.id
                                    })
                                  ),
                                  h.Class(
                                    'flex min-h-11 items-center gap-3 border-b border-border py-3 text-sm text-muted-foreground hover:text-foreground aria-current:font-medium aria-current:text-signal'
                                  )
                                ],
                                [
                                  h.span(
                                    [h.Class('font-mono text-xs')],
                                    [String(index + 1)]
                                  ),
                                  stage.label
                                ]
                              )
                            ]
                          )
                        )
                      )
                    ]
                  ),
                  h.figure(
                    [h.Class('mt-6 hidden lg:block')],
                    [architecture(h, stageNodes[model.stage])]
                  ),
                  h.details(
                    [h.Class('mt-4 lg:hidden')],
                    [
                      h.summary(
                        [
                          h.Class(
                            'min-h-11 cursor-pointer py-3 text-sm underline underline-offset-4'
                          )
                        ],
                        [m.showcase_trace_view_architecture()]
                      ),
                      h.figure(
                        [h.Class('mx-auto max-w-sm')],
                        [architecture(h, stageNodes[model.stage])]
                      )
                    ]
                  )
                ]
              ),
              h.div(
                [h.Class('min-w-0')],
                stages.map((stage, index) =>
                  h.article(
                    [
                      h.Id(`request-${stage.id}`),
                      h.Attribute('data-stage', stage.id),
                      h.Class(
                        index === 0
                          ? 'scroll-mt-24'
                          : 'mt-16 scroll-mt-24 border-t border-border pt-12 sm:mt-24 sm:pt-16'
                      ),
                      h.OnFocusEnter(
                        Message.cases.SelectedStage.make({ stage: stage.id })
                      )
                    ],
                    [
                      h.h3(
                        [h.Class('text-2xl font-medium leading-snug sm:text-3xl')],
                        [stage.title]
                      ),
                      h.p(
                        [
                          h.Class(
                            'mt-2 text-2xl leading-snug text-muted-foreground sm:text-3xl'
                          )
                        ],
                        [stage.description]
                      ),
                      h.div([h.Class('mt-8')], bodies[stage.id])
                    ]
                  )
                )
              )
            ]
          )
        ]
      )
    ]
  )
}
function demo(model: Model, h: H): Html | null {
  const data = model.flags.demo
  if (data === null) {
    return null
  }
  const stats = [
    [m.public_demo_members(), data.memberCount],
    [m.public_demo_roles(), data.roleCount],
    [m.public_demo_audit_events(), data.auditEventTypeCount],
    [m.public_demo_notifications(), data.notificationCount]
  ] as const
  return h.section(
    [
      h.Attribute('aria-labelledby', 'workspace-preview-heading'),
      h.Class('mx-auto max-w-7xl px-5 py-12 sm:px-6 sm:py-20')
    ],
    [
      h.div(
        [h.Class('mb-8 grid items-end gap-5 lg:grid-cols-2 lg:gap-16')],
        [
          h.h2(
            [h.Id('workspace-preview-heading'), h.Class(headingClass)],
            [m.showcase_workspace_heading()]
          ),
          h.p(
            [h.Class('max-w-xl text-base leading-relaxed text-muted-foreground')],
            [m.showcase_workspace_description()]
          )
        ]
      ),
      h.figure(
        [],
        [
          h.a(
            [
              h.Href('/demo'),
              h.Class(
                'group block overflow-hidden border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background'
              )
            ],
            [
              h.picture(
                [],
                [
                  h.source([
                    h.Attribute('media', '(max-width: 639px)'),
                    h.Attribute('srcset', '/images/workspace-preview-mobile.webp')
                  ]),
                  h.img([
                    h.Src('/images/workspace-preview.webp'),
                    h.Alt(m.showcase_workspace_preview_alt()),
                    h.Width('1440'),
                    h.Height('1000'),
                    h.Attribute('loading', 'eager'),
                    h.Attribute('fetchpriority', 'high'),
                    h.Attribute('decoding', 'async'),
                    h.Class(
                      'w-full max-sm:aspect-[390/720] max-sm:object-cover max-sm:object-top'
                    )
                  ])
                ]
              )
            ]
          ),
          h.figcaption(
            [
              h.Class(
                'mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground'
              )
            ],
            [
              h.span([], [m.showcase_workspace_preview_caption()]),
              link(
                h,
                '/demo',
                m.public_demo_open(),
                'inline-flex min-h-11 items-center gap-2 text-foreground underline underline-offset-4'
              )
            ]
          )
        ]
      ),
      h.dl(
        [
          h.Class(
            'mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-6 sm:flex sm:flex-wrap sm:gap-x-10'
          )
        ],
        stats.map(([label, value]) =>
          h.div(
            [h.Class('flex items-baseline gap-2')],
            [
              h.dt(
                [h.Class('min-w-0 break-words text-sm text-muted-foreground')],
                [label]
              ),
              h.dd(
                [h.Class('order-first font-mono text-sm font-medium tabular-nums')],
                [String(value)]
              )
            ]
          )
        )
      )
    ]
  )
}
export function view(model: Model, h: H): Html {
  const providers = [
    ['Stripe', m.provider_stripe_role(), 'card'],
    ['Cloudflare Web Analytics', m.provider_web_analytics_role(), 'chart'],
    ['Cloudflare Email', m.provider_email_role(), 'mail'],
    ['Turnstile', m.provider_turnstile_role(), 'shield']
  ] as const
  const faq = [
    [m.public_faq_q1(), m.public_faq_a1()],
    [m.public_faq_q2(), m.public_faq_a2()],
    [m.public_faq_q3(), m.public_faq_a3()],
    [m.public_faq_q4(), m.public_faq_a4()],
    [m.public_faq_q5(), m.public_faq_a5({ command: DEPLOY_COMMAND })],
    [m.public_faq_q6(), m.public_faq_a6()],
    [m.public_faq_q7(), m.public_faq_a7()]
  ] as const
  return h.main(
    [h.Id('main-content'), h.Tabindex(-1), h.Class('outline-none')],
    [
      h.section(
        [h.Class('relative isolate overflow-hidden border-b border-border')],
        [
          rays(h),
          h.div(
            [
              h.Class(
                'relative mx-auto max-w-7xl px-5 pt-12 pb-14 sm:px-6 sm:pt-20 sm:pb-20 lg:pt-24 lg:pb-24'
              )
            ],
            [
              h.div(
                [h.Class('max-w-6xl')],
                [
                  h.h1(
                    [
                      h.Class(
                        'rise max-w-4xl font-display text-4xl leading-display font-medium text-balance break-words sm:text-6xl xl:text-7xl'
                      )
                    ],
                    [m.landing_headline()]
                  ),
                  h.p(
                    [
                      h.Class(
                        'rise rise-2 mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:mt-8 sm:text-xl'
                      )
                    ],
                    [m.landing_description()]
                  ),
                  h.div(
                    [
                      h.Class(
                        'rise rise-3 mt-8 flex flex-wrap items-center gap-3 sm:mt-10'
                      )
                    ],
                    [
                      h.a(
                        [
                          h.Href(localizeHref('/demo')),
                          h.Class(`${primaryButtonClass} md:h-11`)
                        ],
                        [m.action_open_demo(), icon(h, 'arrow')]
                      ),
                      h.a(
                        [
                          h.Href(GITHUB_URL),
                          h.Target('_blank'),
                          h.Rel('noopener noreferrer'),
                          h.Class(`${buttonClass} md:h-11`)
                        ],
                        [
                          icon(h, 'github'),
                          m.action_view_github(),
                          h.span([h.Class('sr-only')], [m.common_opens_new_tab()])
                        ]
                      )
                    ]
                  )
                ]
              )
            ]
          )
        ]
      ),
      demo(model, h),
      trace(model, h),
      h.section(
        [h.Class('border-t border-border')],
        [
          h.div(
            [h.Class(sectionClass)],
            [
              h.div(
                [h.Class('max-w-2xl')],
                [
                  h.h2([h.Class(headingClass)], [m.landing_optional_providers()]),
                  h.p(
                    [
                      h.Class(
                        'mt-4 text-pretty text-sm leading-relaxed text-muted-foreground'
                      )
                    ],
                    [m.landing_optional_providers_description()]
                  )
                ]
              ),
              h.table(
                [h.Class('w-full table-fixed border-collapse text-left sm:table-auto')],
                [
                  h.caption([h.Class('sr-only')], [m.landing_optional_providers()]),
                  h.thead(
                    [],
                    [
                      h.tr(
                        [
                          h.Class(
                            'border-b border-border font-mono text-2xs text-muted-foreground'
                          )
                        ],
                        [
                          h.th(
                            [
                              h.Attribute('scope', 'col'),
                              h.Class('py-2 pr-4 font-medium')
                            ],
                            [m.showcase_provider_column()]
                          ),
                          h.th(
                            [
                              h.Attribute('scope', 'col'),
                              h.Class('py-2 pr-4 font-medium')
                            ],
                            [m.common_role()]
                          )
                        ]
                      )
                    ]
                  ),
                  h.tbody(
                    [],
                    providers.map(([name, role, symbol]) =>
                      h.tr(
                        [h.Class('border-b border-border')],
                        [
                          h.th(
                            [
                              h.Attribute('scope', 'row'),
                              h.Class('py-3 pr-4 align-baseline text-sm font-medium')
                            ],
                            [
                              h.span(
                                [h.Class('flex items-center gap-2.5')],
                                [
                                  h.span(
                                    [h.Class('text-muted-foreground')],
                                    [icon(h, symbol)]
                                  ),
                                  name
                                ]
                              )
                            ]
                          ),
                          h.td(
                            [
                              h.Class(
                                'break-words py-3 pr-4 align-baseline text-sm text-muted-foreground'
                              )
                            ],
                            [role]
                          )
                        ]
                      )
                    )
                  )
                ]
              )
            ]
          )
        ]
      ),
      h.section(
        [h.Class(sectionClass)],
        [
          h.div(
            [],
            [
              h.h2([h.Class(headingClass)], [m.public_knowledge_heading()]),
              h.p(
                [
                  h.Class(
                    'mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground'
                  )
                ],
                [m.public_knowledge_description()]
              )
            ]
          ),
          h.div(
            [],
            [
              h.p(
                [
                  h.Class(
                    'border-b border-border pb-3 font-mono text-xs text-muted-foreground'
                  )
                ],
                [m.public_knowledge_docs()]
              ),
              h.ul(
                [],
                model.flags.recentDocs.map((doc) =>
                  h.li(
                    [],
                    [
                      h.a(
                        [
                          h.Href(docPath(doc)),
                          h.Class(
                            'group -mx-3 flex items-baseline justify-between gap-6 border-b border-border px-3 py-4 transition-colors hover:bg-accent/40'
                          )
                        ],
                        [
                          h.span(
                            [],
                            [
                              h.span(
                                [
                                  h.Class(
                                    'block text-sm font-medium group-hover:text-primary'
                                  )
                                ],
                                [doc.frontmatter.title]
                              ),
                              h.span(
                                [
                                  h.Class(
                                    'mt-1 block text-sm leading-relaxed text-muted-foreground'
                                  )
                                ],
                                [doc.frontmatter.description]
                              )
                            ]
                          ),
                          icon(h, 'arrow')
                        ]
                      )
                    ]
                  )
                )
              )
            ]
          )
        ]
      ),
      h.section(
        [h.Id('faq'), h.Class('border-t border-border')],
        [
          h.div(
            [h.Class(sectionClass)],
            [
              h.div(
                [],
                [
                  h.h2([h.Class(headingClass)], [m.public_faq_title()]),
                  h.p(
                    [
                      h.Class(
                        'mt-4 text-pretty text-sm leading-relaxed text-muted-foreground'
                      )
                    ],
                    [m.public_faq_description()]
                  )
                ]
              ),
              h.div(
                [],
                faq.map(([question, answer], index) =>
                  h.div(
                    [h.Class('border-b border-border')],
                    [
                      h.h3(
                        [],
                        [
                          h.button(
                            [
                              h.Type('button'),
                              h.Id(`faq-trigger-${index}`),
                              h.Attribute('aria-controls', `faq-panel-${index}`),
                              h.Attribute(
                                'aria-expanded',
                                String(model.openFaq === index)
                              ),
                              h.Disabled(!model.ready),
                              h.OnClick(Message.cases.ToggledFaq.make({ index })),
                              h.Class(
                                'flex min-h-11 w-full items-center justify-between py-4 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring'
                              )
                            ],
                            [question, icon(h, 'chevron')]
                          )
                        ]
                      ),
                      h.div(
                        [
                          h.Id(`faq-panel-${index}`),
                          h.Attribute('data-slot', 'accordion-content'),
                          h.Attribute('data-open', String(model.openFaq === index)),
                          h.Attribute('aria-hidden', String(model.openFaq !== index)),
                          h.Attribute('aria-labelledby', `faq-trigger-${index}`),
                          h.Class('native-faq-panel')
                        ],
                        [
                          h.div(
                            [h.Class('min-h-0')],
                            [
                              h.p(
                                [
                                  h.Class(
                                    'pb-4 text-sm leading-relaxed text-muted-foreground'
                                  )
                                ],
                                [answer]
                              )
                            ]
                          )
                        ]
                      )
                    ]
                  )
                )
              )
            ]
          )
        ]
      ),
      h.section(
        [
          h.Class(
            'band-deep relative isolate overflow-hidden bg-background text-foreground'
          )
        ],
        [
          rays(h, 'top'),
          h.div(
            [
              h.Class(
                'relative mx-auto grid max-w-7xl items-center gap-x-16 gap-y-10 px-5 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:py-24'
              )
            ],
            [
              h.div(
                [],
                [
                  h.h2(
                    [
                      h.Class(
                        'font-display text-balance text-4xl font-medium leading-display sm:text-5xl'
                      )
                    ],
                    [m.landing_fork_headline()]
                  ),
                  h.p(
                    [
                      h.Class(
                        'mt-4 text-pretty text-sm leading-relaxed text-muted-foreground'
                      )
                    ],
                    [m.landing_fork_description()]
                  ),
                  h.div(
                    [h.Class('mt-8 flex flex-wrap gap-3')],
                    [
                      h.a(
                        [
                          h.Href(localizeHref('/demo')),
                          h.Class(`${primaryButtonClass} md:h-11`)
                        ],
                        [m.action_open_demo(), icon(h, 'arrow')]
                      ),
                      link(h, '/docs', m.action_read_docs(), `${buttonClass} md:h-11`)
                    ]
                  )
                ]
              ),
              h.div(
                [h.Class('min-w-0')],
                [
                  h.div(
                    [
                      h.Class(
                        'flex items-center justify-between gap-4 border border-border bg-card/40 px-3 py-2'
                      )
                    ],
                    [
                      h.p(
                        [h.Class('font-mono text-xs text-muted-foreground')],
                        [m.landing_clone_commands()]
                      ),
                      h.output(
                        [
                          h.Attribute('aria-live', 'polite'),
                          h.Class(
                            model.copied === 'failed'
                              ? 'text-xs text-destructive'
                              : 'text-xs text-status-ok'
                          )
                        ],
                        [copyStatus(model)]
                      ),
                      h.button(
                        [
                          h.Type('button'),
                          h.AriaLabel(m.action_copy_commands()),
                          h.Class(`${buttonClass} size-11 px-0 md:size-8`),
                          h.Disabled(!model.ready),
                          h.OnClick(Message.cases.CopyRequested.make({}))
                        ],
                        [icon(h, 'copy')]
                      )
                    ]
                  ),
                  h.section(
                    [
                      h.AriaLabel(m.landing_commands_region()),
                      h.Tabindex(0),
                      h.Class(
                        'overflow-x-auto border border-t-0 border-border bg-card/40'
                      )
                    ],
                    [
                      h.dl(
                        [
                          h.Class(
                            'p-5 font-mono text-xs leading-loose text-foreground sm:text-sm'
                          )
                        ],
                        [
                          h.div(
                            [h.Class('flex gap-3')],
                            [
                              h.dt(
                                [h.Class('shrink-0 text-muted-foreground')],
                                ['$ git clone']
                              ),
                              h.dd(
                                [h.Class('break-all')],
                                [CLONE_COMMAND.replace('git clone ', '')]
                              )
                            ]
                          ),
                          h.div(
                            [h.Class('flex gap-3')],
                            [
                              h.dt(
                                [h.Class('shrink-0 text-muted-foreground')],
                                ['$ cd']
                              ),
                              h.dd([], [REPOSITORY_DIRECTORY])
                            ]
                          ),
                          ...SETUP_STEPS.map((line) =>
                            h.div(
                              [h.Class('flex gap-3')],
                              [
                                h.dt(
                                  [h.Class('shrink-0 text-muted-foreground')],
                                  [`$ ${line}`]
                                ),
                                h.dd([h.Class('sr-only')], [line])
                              ]
                            )
                          ),
                          ...DEV_SERVERS.map((server) =>
                            h.div(
                              [h.Class('flex gap-3')],
                              [
                                h.dt(
                                  [h.Class('w-24 shrink-0 text-muted-foreground')],
                                  [server.label]
                                ),
                                h.dd([], [server.value])
                              ]
                            )
                          )
                        ]
                      )
                    ]
                  )
                ]
              )
            ]
          )
        ]
      )
    ]
  )
}
