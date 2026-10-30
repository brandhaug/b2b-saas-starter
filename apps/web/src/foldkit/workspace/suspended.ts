import { m } from '@b2b-saas-starter/i18n/messages'
import { type Model } from './model'
import { action, heading, link, panel, row, feedback, type H } from './ui'

export function view(model: Model, h: H) {
  if (model.page._tag !== 'suspended') {
    return h.div([], [])
  }
  const data = model.page.data
  return h.div(
    [h.Class('grid gap-6')],
    [
      heading(
        h,
        m.workspace_suspended_title({ workspace: data.workspaceName }),
        data.canViewExplanation
          ? m.workspace_suspended_description()
          : m.workspace_suspended_member_notice()
      ),
      ...(data.canViewExplanation && data.customerExplanation
        ? [
            h.h2([], [m.workspace_suspended_explanation_title()]),
            h.p([h.Role('alert')], [data.customerExplanation])
          ]
        : []),
      link(h, '/workspaces', m.open_workspaces()),
      h.h2([], [m.workspace_suspended_recovery_title()]),
      h.p([], [m.workspace_suspended_recovery_description()]),
      h.p([], [m.workspace_suspended_support_guidance()]),
      ...(data.canManageBilling
        ? [action(h, model, m.workspace_suspended_billing(), { _tag: 'Portal' })]
        : []),
      ...(data.apiTokens === null
        ? []
        : [
            panel(h, m.nav_api_tokens(), [
              h.ul(
                [],
                data.apiTokens.map((token) =>
                  row(h, token.name, token.prefix, [
                    action(
                      h,
                      model,
                      m.action_revoke(),
                      { _tag: 'RevokeToken', id: token.id },
                      true
                    )
                  ])
                )
              )
            ])
          ]),
      ...(data.ssoConnections === null
        ? []
        : [
            panel(
              h,
              m.workspace_suspended_sso(),
              data.ssoConnections.map((connection) =>
                h.div(
                  [h.Class('flex flex-wrap gap-3')],
                  [
                    h.p([], [connection.domain]),
                    ...(connection.enabled
                      ? [
                          action(
                            h,
                            model,
                            m.disable_action(),
                            { _tag: 'UpdateSso', id: connection.id, enabled: false },
                            true
                          )
                        ]
                      : []),
                    action(
                      h,
                      model,
                      m.action_remove(),
                      { _tag: 'RemoveSso', id: connection.id },
                      true
                    )
                  ]
                )
              )
            )
          ]),
      feedback(h, model)
    ]
  )
}
