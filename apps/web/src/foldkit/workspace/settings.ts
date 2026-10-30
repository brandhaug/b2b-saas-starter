import { Effect, type Types } from 'effect'
import { m } from '@b2b-saas-starter/i18n/messages'
import * as Lifecycle from '@/lib/server/workspace-lifecycle'
import * as Sso from '@/lib/server/workspace-sso'
import * as Exports from '@/lib/server/workspace-exports'
import { viewerCan } from '@/lib/permissions'
import { roleLabel, statusLabel } from '@/lib/value-labels'
import { formatTimestampOr } from '@/lib/format-date'
import { call } from '../server-call'
import { type Action, type Model, type Result } from './model'
import {
  action,
  button,
  feedback,
  field,
  heading,
  panel,
  query,
  select,
  tabs,
  tabPanel,
  textarea,
  type H
} from './ui'

export function execute(
  model: Model,
  operation: Extract<
    Action,
    {
      _tag:
        | 'Rename'
        | 'DeleteWorkspace'
        | 'CreateSso'
        | 'UpdateSso'
        | 'TestSso'
        | 'RemoveSso'
        | 'Export'
        | 'DownloadExport'
    }
  >
) {
  const workspaceSlug = model.flags.slug
  const form = model.settings
  return Effect.gen(function* () {
    switch (operation._tag) {
      case 'Rename': {
        const renamed = yield* call(
          () =>
            Lifecycle.renameWorkspaceServerFn({
              data: { workspaceSlug, name: form.name.trim() }
            }),
          m.workspace_rename_failed()
        )
        return {
          _tag: 'Done',
          notice: m.workspace_renamed_to({ name: renamed.name })
        } satisfies Result
      }
      case 'DeleteWorkspace': {
        yield* call(
          () => Lifecycle.deleteWorkspaceServerFn({ data: { workspaceSlug } }),
          m.workspace_delete_failed()
        )
        yield* Effect.sync(() => window.location.assign('/workspaces'))
        break
      }
      case 'CreateSso': {
        const data: Types.Mutable<Sso.CreateSsoConnectionInput> =
          form.protocol === 'oidc'
            ? {
                workspaceSlug,
                protocol: 'oidc',
                domain: form.domain,
                issuer: form.issuer,
                clientId: form.clientId,
                clientSecret: form.clientSecret,
                defaultWorkspaceRole: form.role
              }
            : {
                workspaceSlug,
                protocol: 'saml',
                domain: form.domain,
                defaultWorkspaceRole: form.role,
                ...(form.metadataUrl
                  ? { metadataUrl: form.metadataUrl }
                  : { metadataXml: form.metadataXml })
              }
        if (form.issuer) {
          data.issuer = form.issuer
        }
        yield* call(
          () => Sso.createSsoConnectionServerFn({ data }),
          m.sso_create_failed()
        )
        break
      }
      case 'UpdateSso': {
        const data: Types.Mutable<Sso.UpdateSsoConnectionInput> = {
          workspaceSlug,
          providerId: operation.id
        }
        if (operation.enabled !== undefined) {
          data.enabled = operation.enabled
        }
        if (operation.requireSso !== undefined) {
          data.requireSso = operation.requireSso
        }
        if (operation.role) {
          data.defaultWorkspaceRole = operation.role
        }
        if (operation.rotate) {
          data.clientId = form.clientId
          data.clientSecret = form.clientSecret
        }
        yield* call(
          () =>
            Sso.updateSsoConnectionServerFn({
              data
            }),
          m.sso_update_failed()
        )
        break
      }
      case 'TestSso': {
        const result = yield* call(
          () =>
            Sso.testSsoConnectionServerFn({
              data: { workspaceSlug, providerId: operation.id }
            }),
          m.sso_test_failed()
        )
        return {
          _tag: 'Done',
          notice:
            result.outcome === 'passed'
              ? m.sso_connection_test_passed()
              : `${m.sso_connection_test_failed()} ${result.message}`
        } satisfies Result
      }
      case 'RemoveSso': {
        yield* call(
          () =>
            Sso.removeSsoConnectionServerFn({
              data: { workspaceSlug, providerId: operation.id }
            }),
          m.sso_remove_failed()
        )
        break
      }
      case 'Export': {
        yield* call(
          () => Exports.requestWorkspaceExportServerFn({ data: { workspaceSlug } }),
          m.export_request_failed()
        )
        return { _tag: 'Done', notice: m.export_requested() } satisfies Result
      }
      case 'DownloadExport': {
        const result = yield* call(
          () =>
            Exports.downloadWorkspaceExportServerFn({
              data: { workspaceSlug, exportId: operation.id }
            }),
          m.export_download_failed()
        )
        if (result === null) {
          return { _tag: 'Done', notice: m.export_download_failed() } satisfies Result
        }
        yield* Effect.sync(() => window.location.assign(result))
        break
      }
      default: {
        break
      }
    }
    return { _tag: 'Done', notice: m.common_done() } satisfies Result
  })
}

export function ssoForm(model: Model, h: H) {
  const state = model.settings
  function input(
    key: 'domain' | 'issuer' | 'clientId' | 'clientSecret' | 'metadataUrl',
    label: string,
    type = 'text'
  ) {
    const placeholders: Partial<Record<typeof key, string>> = {
      domain: m.sso_domain_placeholder(),
      issuer: m.sso_issuer_placeholder(),
      metadataUrl: m.sso_metadata_url_placeholder()
    }
    return field(
      h,
      `sso-${key}`,
      label,
      state[key],
      (value) => ({ _tag: 'SettingField', field: key, value }),
      type,
      false,
      placeholders[key] ?? ''
    )
  }
  return h.div(
    [h.Class('grid gap-4')],
    [
      select(
        h,
        m.sso_protocol(),
        state.protocol,
        [
          ['oidc', 'OIDC'],
          ['saml', 'SAML']
        ],
        (value) => ({ _tag: 'SettingField', field: 'protocol', value })
      ),
      input('domain', m.sso_email_domain()),
      h.p([], [m.sso_domain_hint()]),
      input('issuer', m.sso_issuer()),
      ...(state.protocol === 'oidc'
        ? [
            input('clientId', m.sso_client_id()),
            input('clientSecret', m.sso_client_secret(), 'password')
          ]
        : [
            input('metadataUrl', m.sso_metadata_url()),
            textarea(
              h,
              'sso-metadata',
              m.sso_metadata_xml(),
              state.metadataXml,
              (value) => ({ _tag: 'SettingField', field: 'metadataXml', value }),
              false,
              m.sso_metadata_xml_placeholder()
            )
          ]),
      select(
        h,
        m.sso_default_role(),
        state.role,
        [
          ['member', roleLabel('member')],
          ['admin', roleLabel('admin')]
        ],
        (value) => ({ _tag: 'SettingField', field: 'role', value })
      ),
      action(h, model, m.sso_add_connection(), { _tag: 'CreateSso' }),
      feedback(h, model)
    ]
  )
}
export function view(model: Model, h: H) {
  if (model.page._tag !== 'settings') {
    return h.div([], [])
  }
  const data = model.page.data
  const tab = query(model, 'tab') || 'general'
  return h.div(
    [h.Class('grid gap-6')],
    [
      heading(h, m.workspace_settings(), m.workspace_settings_description()),
      tabs(h, model, [
        ['general', m.nav_general()],
        ...(data.ssoConnections === null ? [] : [['sso', m.sso_title()] as const]),
        ...(data.exports === null ? [] : [['exports', m.data_export()] as const])
      ]),
      tabPanel(h, tab, [
        ...(tab === 'general'
          ? [
              panel(h, m.nav_general(), [
                ...(viewerCan(data.viewer, { organization: ['update'] })
                  ? [
                      h.div(
                        [h.Class('grid gap-4 md:grid-cols-2')],
                        [
                          h.p(
                            [h.Class('text-sm text-muted-foreground')],
                            [m.settings_design_workspace_name_hint()]
                          ),
                          field(
                            h,
                            'workspace-name',
                            m.form_workspace_name(),
                            model.settings.name,
                            (value) => ({ _tag: 'SettingField', field: 'name', value })
                          )
                        ]
                      ),
                      button(
                        h,
                        m.save_name(),
                        { _tag: 'Perform', action: { _tag: 'Rename' } },
                        model.pending ||
                          model.settings.name.trim() === data.workspaceName
                      )
                    ]
                  : [h.p([], [m.workspace_manage_denied()])]),
                ...(viewerCan(data.viewer, { organization: ['delete'] })
                  ? [
                      h.div(
                        [h.Class('grid gap-3 border-t pt-6')],
                        [
                          h.p(
                            [],
                            [
                              m.workspace_delete_description({
                                name: data.workspaceName
                              })
                            ]
                          ),
                          action(
                            h,
                            model,
                            m.delete_workspace(),
                            { _tag: 'DeleteWorkspace' },
                            true
                          )
                        ]
                      )
                    ]
                  : [])
              ])
            ]
          : []),
        ...(tab === 'sso' && data.ssoConnections !== null
          ? [
              panel(h, m.sso_title(), [
                h.p([], [m.sso_description()]),
                ...(data.ssoConnections.length
                  ? []
                  : [
                      h.p([], [m.empty_no_sso()]),
                      h.p([], [m.sso_empty_description()])
                    ]),
                ...(viewerCan(data.viewer, { sso: ['create'] })
                  ? [button(h, m.sso_add_connection(), { _tag: 'Open', dialog: 'sso' })]
                  : [h.p([], [m.sso_manage_denied()])]),
                ...data.ssoConnections.map((connection) =>
                  h.article(
                    [h.Class('grid gap-3 border-t py-4')],
                    [
                      h.h3([h.Class('font-medium')], [connection.domain]),
                      h.code([], [connection.id]),
                      ...(connection.clientIdLastFour
                        ? [
                            h.p(
                              [],
                              [
                                m.sso_connection_client({
                                  id: connection.clientIdLastFour
                                })
                              ]
                            )
                          ]
                        : []),
                      h.p(
                        [],
                        [`${connection.protocol.toUpperCase()} · ${connection.issuer}`]
                      ),
                      h.p(
                        [],
                        [
                          `${connection.enabled ? m.common_enabled() : m.common_disabled()} · ${m.sso_connection_joins()} ${roleLabel(connection.defaultWorkspaceRole)}`
                        ]
                      ),
                      ...(viewerCan(data.viewer, { sso: ['update'] })
                        ? [
                            h.div(
                              [h.Class('flex flex-wrap gap-2')],
                              [
                                action(
                                  h,
                                  model,
                                  connection.enabled
                                    ? m.sso_connection_disable()
                                    : m.sso_connection_enable(),
                                  {
                                    _tag: 'UpdateSso',
                                    id: connection.id,
                                    enabled: !connection.enabled
                                  }
                                ),
                                action(h, model, m.sso_test(), {
                                  _tag: 'TestSso',
                                  id: connection.id
                                }),
                                h.button(
                                  [
                                    h.Type('button'),
                                    h.Role('switch'),
                                    h.Attribute(
                                      'aria-checked',
                                      String(connection.requireSso)
                                    ),
                                    h.Disabled(model.pending),
                                    h.OnClick({
                                      _tag: 'Perform',
                                      action: {
                                        _tag: 'UpdateSso',
                                        id: connection.id,
                                        requireSso: !connection.requireSso
                                      }
                                    })
                                  ],
                                  [m.sso_connection_require()]
                                )
                              ]
                            ),
                            select(
                              h,
                              m.common_role(),
                              connection.defaultWorkspaceRole,
                              [
                                ['member', roleLabel('member')],
                                ['admin', roleLabel('admin')]
                              ],
                              (value) => ({
                                _tag: 'Perform',
                                action: {
                                  _tag: 'UpdateSso',
                                  id: connection.id,
                                  role: value === 'admin' ? 'admin' : 'member'
                                }
                              })
                            ),
                            ...(connection.protocol === 'oidc'
                              ? [
                                  h.details(
                                    [],
                                    [
                                      h.summary([], [m.rotate_secret()]),
                                      field(
                                        h,
                                        `sso-client-${connection.id}`,
                                        m.sso_client_id(),
                                        model.settings.clientId,
                                        (value) => ({
                                          _tag: 'SettingField',
                                          field: 'clientId',
                                          value
                                        })
                                      ),
                                      field(
                                        h,
                                        `sso-secret-${connection.id}`,
                                        m.sso_client_secret(),
                                        model.settings.clientSecret,
                                        (value) => ({
                                          _tag: 'SettingField',
                                          field: 'clientSecret',
                                          value
                                        }),
                                        'password'
                                      ),
                                      action(
                                        h,
                                        model,
                                        m.rotate_secret(),
                                        {
                                          _tag: 'UpdateSso',
                                          id: connection.id,
                                          rotate: true
                                        },
                                        true
                                      )
                                    ]
                                  )
                                ]
                              : [])
                          ]
                        : []),
                      ...(viewerCan(data.viewer, { sso: ['remove'] })
                        ? [
                            action(
                              h,
                              model,
                              `${m.action_remove()} ${connection.domain}`,
                              { _tag: 'RemoveSso', id: connection.id },
                              true
                            )
                          ]
                        : [])
                    ]
                  )
                )
              ])
            ]
          : []),
        ...(tab === 'exports' && data.exports !== null
          ? [
              panel(h, m.data_export(), [
                h.p([], [m.export_description()]),
                data.exports.availability.available
                  ? action(h, model, m.request_export(), { _tag: 'Export' })
                  : h.p([], [data.exports.availability.reason]),
                ...(data.exports.exports.length
                  ? []
                  : [
                      h.p([], [m.empty_no_exports()]),
                      h.p([], [m.export_empty_description()])
                    ]),
                ...data.exports.exports.map((entry) =>
                  h.article(
                    [h.Class('grid gap-2 border-t py-4')],
                    [
                      h.p([], [statusLabel(entry.status)]),
                      h.p(
                        [],
                        [
                          m.export_requested_at({
                            time: formatTimestampOr(entry.requestedAt, m.empty_value())
                          })
                        ]
                      ),
                      ...(entry.status === 'pending'
                        ? [h.p([], [m.export_building()])]
                        : []),
                      ...(entry.status === 'failed'
                        ? [
                            h.p(
                              [],
                              [
                                m.export_failed({
                                  reason: entry.failureReason
                                    ? `: ${entry.failureReason}`
                                    : ''
                                })
                              ]
                            )
                          ]
                        : []),
                      ...(entry.status === 'ready'
                        ? [
                            h.p(
                              [],
                              [
                                m.export_available_until({
                                  time: formatTimestampOr(
                                    entry.expiresAt,
                                    m.unknown_value()
                                  )
                                })
                              ]
                            ),
                            action(h, model, m.action_download_archive(), {
                              _tag: 'DownloadExport',
                              id: entry.id
                            })
                          ]
                        : [])
                    ]
                  )
                )
              ])
            ]
          : []),
        feedback(h, model)
      ])
    ]
  )
}
