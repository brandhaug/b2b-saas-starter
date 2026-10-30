import { Effect, Option, Schema } from 'effect'
import { Command, ManagedResource, Subscription, type Update } from 'foldkit'
import { defineView } from 'foldkit/submodel'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import { type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { deLocalizeUrl } from '@b2b-saas-starter/i18n/runtime'
import { RouteSession, type PageData } from '@/http/page-contract'
import { loadWorkspaceDirectoryServerFnResponse } from '@/http/contracts/workspace-directory'
import { viewerCan } from '@/lib/permissions'
import { authClient } from '@/lib/auth-client'
import { navigateDocument } from '@/lib/document-navigation'
import { stopImpersonatingServerFn } from '@/lib/server/admin'
import { seedWorkspaceRecord } from '@b2b-saas-starter/capabilities/governance/workspace-identity.seed'
import { call } from '../server-call'
import { type DocMeta } from '../docs/contracts'
import * as Controls from './public-shell'
import * as Support from './support'
import { buttonClass, inputClass, icon, link } from './view'

const Viewer = Schema.Struct({ role: Schema.Literals(['owner', 'admin', 'member']) })
export const Flags = Schema.Struct({
  controls: Controls.Flags,
  session: Schema.NullOr(RouteSession),
  directory: loadWorkspaceDirectoryServerFnResponse,
  workspaceSlug: Schema.NullOr(Schema.String),
  viewer: Schema.NullOr(Viewer),
  preview: Schema.Boolean,
  unreadCount: Schema.NullOr(Schema.Number),
  wide: Schema.Boolean
})
export type Flags = typeof Flags.Type
export const Model = Schema.Struct({
  flags: Flags,
  controls: Controls.Model,
  support: Support.Model,
  pending: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  rememberedSlug: Schema.NullOr(Schema.String)
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Controls: { message: Controls.Message },
  Support: { message: Support.Message },
  SignOut: {},
  StopImpersonating: {},
  Failed: { error: Schema.String },
  Completed: {},
  Remembered: { slug: Schema.NullOr(Schema.String) },
  SwitchedWorkspace: { slug: Schema.String }
})
export type Message = typeof Message.Type
function controlsMessage(message: Controls.Message): Message {
  return Message.cases.Controls.make({ message })
}
function supportMessage(message: Support.Message): Message {
  return Message.cases.Support.make({ message })
}
const Leave = Command.define('ApplicationShell.Leave', {
  args: { impersonating: Schema.Boolean, userId: Schema.String },
  messages: [Message.cases.Completed, Message.cases.Failed],
  execute: ({ impersonating, userId }) =>
    Effect.gen(function* () {
      if (impersonating) {
        yield* call(() => stopImpersonatingServerFn(), m.impersonation_failure())
      } else {
        const result = yield* call(() => authClient.signOut(), m.auth_sign_out_failed())
        if (result.error) {
          return Message.cases.Failed.make({ error: m.auth_sign_out_failed() })
        }
      }
      yield* Effect.try(() =>
        sessionStorage.removeItem(`starter-workspace:${userId}`)
      ).pipe(Effect.ignore)
      yield* Effect.sync(() => navigateDocument(impersonating ? '/admin' : '/sign-in'))
      return Message.cases.Completed.make({})
    }).pipe(
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Message.cases.Failed.make({ error: error.message }))
      )
    )
})
const Remember = Command.define('ApplicationShell.Remember', {
  args: { userId: Schema.String, slug: Schema.NullOr(Schema.String) },
  messages: [Message.cases.Remembered],
  execute: ({ userId, slug }) =>
    Effect.try(() => {
      const key = `starter-workspace:${userId}`
      if (slug !== null) {
        sessionStorage.setItem(key, slug)
      }
      return Message.cases.Remembered.make({
        slug: slug ?? sessionStorage.getItem(key)
      })
    }).pipe(Effect.catch(() => Effect.succeed(Message.cases.Remembered.make({ slug }))))
})
const Navigate = Command.define('ApplicationShell.Navigate', {
  args: { slug: Schema.String },
  messages: [Message.cases.Completed],
  execute: ({ slug }) =>
    Effect.sync(() => {
      window.location.assign(`/workspaces/${encodeURIComponent(slug)}`)
      return Message.cases.Completed.make({})
    })
})

type NavRow = {
  href: string
  label: string
  group: string
  permission?: PermissionRequest
}
function workspacePrefix(preview: boolean, slug: string | null): string | null {
  if (preview) {
    return '/demo'
  }
  return slug === null ? null : `/workspaces/${encodeURIComponent(slug)}`
}
export function navigation(
  flags: Flags,
  workspaceSlug = flags.workspaceSlug
): ReadonlyArray<NavRow> {
  const prefix = workspacePrefix(flags.preview, workspaceSlug)
  const workspace: ReadonlyArray<NavRow> =
    prefix === null
      ? []
      : [
          { href: prefix, label: m.nav_overview(), group: m.nav_workspace_group() },
          {
            href: `${prefix}/assistant`,
            label: m.nav_assistant(),
            group: m.nav_workspace_group()
          },
          {
            href: `${prefix}/members`,
            label: m.nav_members(),
            group: m.nav_administration_group()
          },
          {
            href: `${prefix}/settings`,
            label: m.nav_settings(),
            group: m.nav_administration_group()
          },
          {
            href: `${prefix}/billing`,
            label: m.nav_billing(),
            group: m.nav_administration_group()
          },
          {
            href: `${prefix}/audit`,
            label: m.nav_audit_trail(),
            group: m.nav_administration_group(),
            permission: { auditLog: ['read'] }
          },
          {
            href: `${prefix}/api-tokens`,
            label: m.nav_api_tokens(),
            group: m.nav_developer_group(),
            permission: { apiToken: ['list'] }
          },
          {
            href: `${prefix}/webhooks`,
            label: m.nav_webhook_endpoints(),
            group: m.nav_developer_group(),
            permission: { webhook: ['list'] }
          }
        ]
  return [
    ...workspace.filter(
      (row) => row.permission === undefined || viewerCan(flags.viewer, row.permission)
    ),
    {
      href: flags.preview ? '/sign-in' : '/account',
      label: flags.preview ? m.demo_try_sign_in() : m.nav_account(),
      group: m.nav_you_group()
    },
    ...(!flags.preview && flags.session?.user.role === 'admin'
      ? [{ href: '/admin', label: m.nav_system_admin(), group: m.nav_you_group() }]
      : []),
    { href: '/help', label: m.public_meta_support(), group: m.nav_you_group() }
  ]
}
const decodeViewer = Schema.decodeUnknownOption(Schema.Struct({ viewer: Viewer }))
const decodeUnread = Schema.decodeUnknownOption(
  Schema.Struct({ unreadCount: Schema.Number })
)
export function flagsForPage(
  url: URL,
  data: PageData,
  docs: ReadonlyArray<DocMeta> = []
): Flags {
  const path = deLocalizeUrl(url).pathname.replace(/\/$/, '') || '/'
  const preview = path === '/demo' || path.startsWith('/demo/')
  const parts = path.split('/')
  let workspaceSlug: string | null = null
  if (parts[1] === 'workspaces' && parts[2]) {
    const requestedSlug = decodeURIComponent(parts[2])
    workspaceSlug = data.directory?.some((row) => row.workspace.slug === requestedSlug)
      ? requestedSlug
      : null
  }
  if (preview) {
    workspaceSlug = seedWorkspaceRecord.slug
  }
  const payload = data.page !== null && 'data' in data.page ? data.page.data : null
  const viewer = decodeViewer(payload)
  const unread = decodeUnread(payload)
  const flags: Flags = {
    controls: {
      signedIn: !preview && data.presentation.authenticated,
      locale: data.locale,
      docs,
      path
    },
    session: data.session,
    directory: data.directory ?? [],
    workspaceSlug,
    viewer: preview
      ? { role: 'owner' }
      : Option.getOrNull(Option.map(viewer, (value) => value.viewer)),
    preview,
    unreadCount: Option.isSome(unread) ? unread.value.unreadCount : null,
    wide:
      ['members', 'audit', 'webhooks', 'api-tokens', 'assistant'].includes(
        parts.at(-1) ?? ''
      ) || path === '/admin'
  }
  return { ...flags, controls: { ...flags.controls, commands: paletteEntries(flags) } }
}
function paletteEntries(flags: Flags) {
  const rows = navigation(flags).map((row) => ({
    href: row.href,
    label: row.label,
    keywords: row.group
  }))
  const prefix = workspacePrefix(flags.preview, flags.workspaceSlug)
  if (prefix === null) {
    rows.unshift({ href: '/workspaces', label: m.open_workspaces(), keywords: '' })
  } else {
    const actions: ReadonlyArray<{
      label: string
      href: string
      permission: PermissionRequest
    }> = [
      {
        label: m.form_invite_member(),
        href: `${prefix}/members?action=invite`,
        permission: { invitation: ['create'] }
      },
      {
        label: m.tokens_create_title(),
        href: `${prefix}/api-tokens?action=create`,
        permission: { apiToken: ['create'] }
      },
      {
        label: m.register_endpoint(),
        href: `${prefix}/webhooks?action=create`,
        permission: { webhook: ['create'] }
      }
    ]
    const permitted = []
    for (const action of actions) {
      if (viewerCan(flags.viewer, action.permission)) {
        permitted.push({
          href: action.href,
          label: action.label,
          keywords: m.workspace_actions()
        })
      }
    }
    rows.unshift(...permitted)
  }
  return rows
}
export function init(flags: Flags): Update.Return<Model, Message> {
  const controls = Controls.init(flags.controls)
  const workspace = flags.directory.find(
    (row) => row.workspace.slug === flags.workspaceSlug
  )?.workspace
  const support = Support.init({
    routeName: flags.workspaceSlug === null ? 'application' : 'workspace',
    workspaceId: workspace?.id ?? null,
    appVersion: null
  })
  return {
    model: {
      flags,
      controls: controls.model,
      support: support.model,
      pending: false,
      error: null,
      rememberedSlug: flags.workspaceSlug
    },
    commands: [
      ...(controls.commands ?? []).map((command) =>
        Command.mapMessage(command, controlsMessage)
      ),
      ...(flags.session && !flags.preview
        ? [Remember({ userId: flags.session.user.id, slug: flags.workspaceSlug })]
        : [])
    ]
  }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Controls': {
      const result = Controls.update(model.controls, message.message)
      return {
        model: { ...model, controls: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, controlsMessage)
        )
      }
    }
    case 'Support': {
      const result = Support.update(model.support, message.message)
      return {
        model: { ...model, support: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, supportMessage)
        )
      }
    }
    case 'Remembered': {
      return {
        model: {
          ...model,
          rememberedSlug: model.flags.directory.some(
            (row) => row.workspace.slug === message.slug
          )
            ? message.slug
            : null
        }
      }
    }
    case 'SignOut':
    case 'StopImpersonating': {
      return model.pending || model.flags.preview || model.flags.session === null
        ? { model }
        : {
            model: { ...model, pending: true, error: null },
            commands: [
              Leave({
                impersonating: message._tag === 'StopImpersonating',
                userId: model.flags.session.user.id
              })
            ]
          }
    }
    case 'Failed': {
      return { model: { ...model, pending: false, error: message.error } }
    }
    case 'Completed': {
      return { model }
    }
    case 'SwitchedWorkspace': {
      return model.flags.preview ||
        !model.flags.directory.some((row) => row.workspace.slug === message.slug)
        ? { model }
        : { model, commands: [Navigate({ slug: message.slug })] }
    }
  }
}
export const subscriptions = Subscription.lift(Controls.subscriptions)<Model, Message>({
  read: (model) => Option.some(model.controls),
  toParentMessage: controlsMessage
})
export const managedResources = ManagedResource.lift(Controls.managedResources)<
  Model,
  Message
>({ read: (model) => Option.some(model.controls), toParentMessage: controlsMessage })
type H = HtmlBuilder<Message>
function workspacePicker(model: Model, h: H, slug: string | null): Html {
  if (model.flags.preview) {
    return h.p(
      [
        h.Class('rounded-md border border-sidebar-border px-3 py-2 text-sm font-medium')
      ],
      [seedWorkspaceRecord.name]
    )
  }
  if (model.flags.directory.length === 0) {
    return link(h, '/workspaces', m.workspace_choose(), buttonClass)
  }
  return h.select(
    [
      h.AriaLabel(m.common_switch_workspace()),
      h.Class(inputClass),
      h.Value(slug ?? ''),
      h.OnChange((value) => Message.cases.SwitchedWorkspace.make({ slug: value }))
    ],
    [
      h.option([h.Value('')], [m.workspace_choose()]),
      ...model.flags.directory.map(({ workspace }) =>
        h.option([h.Value(workspace.slug)], [workspace.name])
      )
    ]
  )
}
function sidebar(model: Model, h: H): Html {
  const workspaceSlug = model.flags.workspaceSlug ?? model.rememberedSlug
  let group = ''
  const rows = navigation(model.flags, workspaceSlug).flatMap((row) => {
    const label =
      group === row.group
        ? []
        : [
            h.p(
              [
                h.Class(
                  'px-3 pt-4 pb-1 font-mono text-2xs font-medium text-sidebar-foreground/60'
                )
              ],
              [row.group]
            )
          ]
    group = row.group
    const active = model.flags.controls.path === row.href
    label.push(
      h.a(
        [
          h.Href(row.href),
          ...(active
            ? [
                h.Attribute('aria-current', 'page'),
                h.Attribute('data-status', 'active')
              ]
            : []),
          h.Class(
            'flex min-h-9 items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground data-[status=active]:ring-1 data-[status=active]:ring-inset data-[status=active]:ring-primary max-md:min-h-11'
          )
        ],
        [row.label]
      )
    )
    return label
  })
  return h.div(
    [h.Class('flex min-h-full flex-col')],
    [
      h.a(
        [h.Href('/'), h.Class('flex items-center gap-2 font-semibold')],
        [
          h.img([
            h.Src('/assets/starter-logo.png'),
            h.Alt(''),
            h.Width('40'),
            h.Height('40'),
            h.Class('size-10 shrink-0')
          ]),
          'B2B SaaS Starter'
        ]
      ),
      h.div([h.Class('mt-6')], [workspacePicker(model, h, workspaceSlug)]),
      h.nav(
        [h.AriaLabel(m.main_navigation()), h.Class('mt-6 flex flex-1 flex-col gap-1')],
        rows
      )
    ]
  )
}
const ControlsView = defineView<
  { controls: Controls.Model; menu: Html },
  Controls.Message
>((model, h) => h.div([], Controls.overlays(model.controls, h, model.menu)))
const LocaleView = defineView<
  { controls: Controls.Model; id: string },
  Controls.Message
>((model, h) => Controls.localePicker(model.controls, h, model.id))
const SearchView = defineView<Controls.Model, Controls.Message>(Controls.searchButton)
const SupportView = defineView<Support.Model, Support.Message>(Support.view)
export function view(model: Model, h: H, body: Html): Html {
  const { flags } = model
  const session = flags.session
  const name = flags.preview
    ? seedWorkspaceRecord.name
    : (flags.directory.find((row) => row.workspace.slug === flags.workspaceSlug)
        ?.workspace.name ?? flags.workspaceSlug)
  const locale = h.submodel({
    slotId: 'application-locale',
    model: { controls: model.controls, id: 'application-locale-desktop' },
    view: LocaleView,
    toParentMessage: controlsMessage
  })
  const search = h.submodel({
    slotId: 'application-search',
    model: model.controls,
    view: SearchView,
    toParentMessage: controlsMessage
  })
  return h.div(
    [h.Class('grid min-h-dvh bg-background lg:grid-cols-[16rem_1fr]')],
    [
      link(
        h,
        '#main-content',
        m.common_skip_to_content(),
        'sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary px-3 py-2 text-sm focus:text-primary-foreground'
      ),
      h.aside(
        [
          h.Class(
            'sticky top-0 hidden h-dvh overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground p-4 lg:block'
          )
        ],
        [sidebar(model, h)]
      ),
      h.div(
        [h.Class('min-w-0')],
        [
          !flags.preview && session?.impersonatedBy
            ? h.div(
                [
                  h.Role('status'),
                  h.Class(
                    'flex flex-wrap items-center gap-3 border-b border-destructive px-4 py-3'
                  )
                ],
                [
                  h.span(
                    [h.Class('flex-1')],
                    [
                      m.impersonating_notice({
                        name: session.user.name,
                        email: session.user.email
                      })
                    ]
                  ),
                  h.button(
                    [
                      h.Type('button'),
                      h.Class(buttonClass),
                      h.Disabled(model.pending),
                      h.OnClick(Message.cases.StopImpersonating.make({}))
                    ],
                    [m.stop_impersonating()]
                  )
                ]
              )
            : null,
          h.header(
            [
              h.Class(
                'flex min-h-16 items-center gap-4 border-b border-border px-4 sm:px-6'
              )
            ],
            [
              h.button(
                [
                  h.Type('button'),
                  h.Class(`${buttonClass} lg:hidden`),
                  h.AriaLabel(m.common_open_navigation()),
                  h.OnClick(
                    controlsMessage(
                      Controls.Message.cases.Opened.make({ dialog: 'menu' })
                    )
                  )
                ],
                [icon(h, 'menu')]
              ),
              name
                ? link(
                    h,
                    flags.preview ? '/demo' : `/workspaces/${flags.workspaceSlug}`,
                    name,
                    'min-w-0 flex-1 truncate text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-4 lg:invisible'
                  )
                : h.div([h.Class('min-w-0 flex-1')]),
              h.div([h.Class('hidden shrink-0 md:block')], [locale]),
              h.div([h.Class('hidden shrink-0 md:block')], [search]),
              flags.unreadCount === null
                ? null
                : h.a(
                    [
                      h.Href(
                        flags.preview ? '/demo/notifications' : '/account/notifications'
                      ),
                      h.AriaLabel(m.unread_notifications({ count: flags.unreadCount })),
                      h.Class(
                        'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border font-mono text-sm tabular-nums'
                      )
                    ],
                    [String(flags.unreadCount)]
                  ),
              flags.preview
                ? null
                : h.details(
                    [h.Class('relative')],
                    [
                      h.summary(
                        [
                          h.Class(`${buttonClass} cursor-pointer`),
                          h.AriaLabel(m.open_user_menu()),
                          h.Role('button')
                        ],
                        [session?.user.name ?? m.signed_in()]
                      ),
                      h.div(
                        [
                          h.Class(
                            'absolute right-0 z-40 mt-2 grid w-64 gap-2 rounded-md border border-border bg-popover p-3 shadow-md'
                          )
                        ],
                        [
                          h.p(
                            [h.Class('truncate text-sm font-medium')],
                            [session?.user.name ?? m.signed_in()]
                          ),
                          session
                            ? h.p(
                                [h.Class('truncate text-xs text-muted-foreground')],
                                [session.user.email]
                              )
                            : null,
                          link(h, '/account', m.nav_account()),
                          ...flags.directory.map(({ workspace }) =>
                            link(h, `/workspaces/${workspace.slug}`, workspace.name)
                          ),
                          session?.user.role === 'admin'
                            ? link(h, '/admin', m.nav_system_admin())
                            : null,
                          h.button(
                            [
                              h.Type('button'),
                              h.Class(buttonClass),
                              h.Disabled(model.pending),
                              h.OnClick(Message.cases.SignOut.make({}))
                            ],
                            [m.sign_out()]
                          )
                        ]
                      )
                    ]
                  )
            ]
          ),
          model.error || model.controls.error
            ? h.p(
                [
                  h.Role('alert'),
                  h.Class('border-b border-border px-4 py-2 text-sm text-destructive')
                ],
                [model.error ?? model.controls.error ?? '']
              )
            : null,
          flags.preview
            ? h.div(
                [
                  h.Class(
                    'flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/40 px-4 py-2 text-muted-foreground sm:px-8'
                  )
                ],
                [
                  h.p([h.Class('text-sm')], [m.demo_preview_notice()]),
                  link(h, '/sign-in', m.demo_try_sign_in(), buttonClass)
                ]
              )
            : null,
          h.main(
            [
              h.Id('main-content'),
              h.Tabindex(-1),
              h.Class('px-4 py-8 sm:px-8 outline-none')
            ],
            [
              h.div(
                [
                  h.Class(
                    `mx-auto grid w-full gap-8 ${flags.wide ? 'max-w-7xl' : 'max-w-4xl'}`
                  )
                ],
                [
                  body,
                  flags.preview
                    ? null
                    : h.footer(
                        [h.Class('border-t border-border pt-6')],
                        [
                          h.submodel({
                            slotId: 'application-support',
                            model: model.support,
                            view: SupportView,
                            toParentMessage: supportMessage
                          })
                        ]
                      )
                ]
              )
            ]
          )
        ]
      ),
      h.submodel({
        slotId: 'application-overlays',
        model: {
          controls: model.controls,
          menu: h.div(
            [h.Class('grid gap-4 py-4')],
            [
              sidebar(model, h),
              h.submodel({
                slotId: 'application-locale-mobile',
                model: { controls: model.controls, id: 'application-locale-mobile' },
                view: LocaleView,
                toParentMessage: controlsMessage
              }),
              h.submodel({
                slotId: 'application-search-mobile',
                model: model.controls,
                view: SearchView,
                toParentMessage: controlsMessage
              })
            ]
          )
        },
        view: ControlsView,
        toParentMessage: controlsMessage
      })
    ]
  )
}
