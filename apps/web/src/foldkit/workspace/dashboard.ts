import { m } from '@b2b-saas-starter/i18n/messages'
import { attentionItems } from '@/lib/attention'
import { viewerCan } from '@/lib/permissions'
import { type Model } from './model'
import * as Notifications from './notifications'
import { action, feedback, heading, href, link, panel, type H } from './ui'

export function view(model: Model, h: H) {
  const accountHref = model.flags.preview ? '/sign-in' : '/account'
  if (model.page._tag !== 'dashboard') {
    return h.div([], [])
  }
  const data = model.page.data
  const attention = attentionItems({
    invitations: data.invitations,
    apiTokens: data.apiTokens,
    webhooks: data.webhooks,
    auditEvents: null
  })
  const invite = viewerCan(data.viewer, { invitation: ['create'] })
  const steps = data.progress.steps
    .filter(
      (step) =>
        step.id === 'enable_two_factor' || (invite && step.id === 'invite_member')
    )
    .toSorted((a, b) => Number(a.complete) - Number(b.complete))
  const count = steps.filter((step) => step.complete).length
  return h.div(
    [h.Class('grid gap-6')],
    [
      heading(h, data.workspace.name, m.dashboard_attention_description()),
      h.div(
        [
          h.Class(
            'grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.8fr)] lg:items-start'
          )
        ],
        [
          panel(
            h,
            attention.length ? m.needs_attention() : m.workspace_healthy_title(),
            attention.length
              ? attention.map((item) =>
                  h.article(
                    [h.Class('grid gap-2 border-b border-border py-3')],
                    [
                      h.h3([h.Class('font-medium')], [item.title]),
                      h.span(
                        [h.Class('sr-only')],
                        [
                          item.severity === 'warn'
                            ? m.attention_warning()
                            : m.attention_information()
                        ]
                      ),
                      h.p(
                        [h.Class('text-sm text-muted-foreground')],
                        [item.description]
                      ),
                      link(
                        h,
                        `${item.to.replace('/workspaces/$workspaceSlug', href(model))}${item.search ? `?${new URLSearchParams(Object.entries(item.search).flatMap(([key, value]) => (value ? [[key, value]] : []))).toString()}` : ''}`,
                        item.linkLabel
                      )
                    ]
                  )
                )
              : [
                  h.p(
                    [h.Class('text-sm text-muted-foreground')],
                    [m.workspace_healthy_description()]
                  )
                ]
          ),
          ...(data.progress.dismissedAt === null
            ? [
                panel(h, m.setup_workspace(), [
                  ...(count === steps.length
                    ? [h.p([], [m.setup_workspace_complete()])]
                    : []),
                  h.div(
                    [h.Class('flex items-center justify-between gap-3')],
                    [
                      h.p(
                        [],
                        [
                          m.onboarding_progress({
                            completedCount: count,
                            totalCount: steps.length
                          })
                        ]
                      ),
                      ...(viewerCan(data.viewer, { onboarding: ['dismiss'] })
                        ? [
                            action(h, model, m.dismiss_action(), {
                              _tag: 'DismissChecklist'
                            })
                          ]
                        : [])
                    ]
                  ),
                  h.progress(
                    [
                      h.Attribute('max', String(steps.length)),
                      h.Attribute('value', String(count)),
                      h.Attribute(
                        'aria-label',
                        m.onboarding_progress({
                          completedCount: count,
                          totalCount: steps.length
                        })
                      ),
                      h.Attribute('data-slot', 'setup-progress'),
                      h.Class('h-1.5 w-full')
                    ],
                    []
                  ),
                  h.ul(
                    [h.Class('grid gap-2')],
                    steps.map((step) =>
                      h.li(
                        [h.Class('text-sm')],
                        [
                          h.span(
                            [],
                            [
                              step.complete
                                ? `${m.common_done()} · `
                                : `${m.common_to_do()} · `
                            ]
                          ),
                          ...(step.complete
                            ? [
                                h.span(
                                  [],
                                  [
                                    step.id === 'enable_two_factor'
                                      ? m.onboarding_enable_two_factor()
                                      : m.onboarding_invite_member()
                                  ]
                                )
                              ]
                            : [
                                link(
                                  h,
                                  step.id === 'enable_two_factor'
                                    ? accountHref
                                    : `${href(model, '/members')}?action=invite`,
                                  step.id === 'enable_two_factor'
                                    ? m.onboarding_enable_two_factor()
                                    : m.onboarding_invite_member()
                                )
                              ]),
                          ...(!model.flags.preview &&
                          !viewerCan(data.viewer, { onboarding: ['dismiss'] })
                            ? [
                                h.p(
                                  [h.Class('text-xs text-muted-foreground')],
                                  [m.onboarding_dismiss_owner_note()]
                                )
                              ]
                            : [])
                        ]
                      )
                    )
                  ),
                  ...(invite
                    ? [
                        h.details(
                          [h.Class('border-t pt-4')],
                          [
                            h.summary(
                              [h.Class('cursor-pointer text-sm')],
                              [m.onboarding_developer_setup()]
                            ),
                            h.div(
                              [h.Class('grid gap-2 pt-3')],
                              [
                                h.p(
                                  [h.Class('text-sm text-muted-foreground')],
                                  [m.onboarding_workflow_guidance()]
                                ),
                                link(
                                  h,
                                  '/docs/capability-interfaces/api-tokens',
                                  m.onboarding_api_docs()
                                ),
                                link(
                                  h,
                                  `${href(model, '/api-tokens')}?action=create`,
                                  m.onboarding_create_api_token()
                                ),
                                link(
                                  h,
                                  `${href(model, '/webhooks')}?action=create`,
                                  m.onboarding_add_webhook_endpoint()
                                ),
                                link(
                                  h,
                                  href(model, '/audit'),
                                  m.onboarding_review_audit()
                                )
                              ]
                            )
                          ]
                        )
                      ]
                    : [
                        h.p([], [m.onboarding_member_orientation()]),
                        link(h, href(model, '/members'), m.onboarding_meet_team()),
                        link(
                          h,
                          model.flags.preview ? '/sign-in' : '/account/notifications',
                          m.notifications_title()
                        )
                      ])
                ])
              ]
            : []),
          Notifications.view(model, h)
        ]
      ),
      ...(model.failedAction?._tag === 'MarkRead' ||
      model.failedAction?._tag === 'Refresh'
        ? []
        : [feedback(h, model)])
    ]
  )
}
