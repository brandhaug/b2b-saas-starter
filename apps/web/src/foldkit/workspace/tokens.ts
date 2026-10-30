import { Effect, type Types } from 'effect'
import { m } from '@b2b-saas-starter/i18n/messages'
import * as Api from '@/lib/server/api-tokens'
import { viewerCan, apiTokenScopes } from '@/lib/permissions'
import { formatTimestampOr } from '@/lib/format-date'
import { call } from '../server-call'
import { type Action, type Model, type Result } from './model'
import {
  action,
  actionMenu,
  button,
  checkbox,
  feedback,
  field,
  heading,
  panel,
  row,
  secret,
  type H
} from './ui'
import { listControls, paged, pagination } from './table'

export function execute(
  model: Model,
  operation: Extract<Action, { _tag: 'CreateToken' | 'ReplaceToken' | 'RevokeToken' }>
) {
  const workspaceSlug = model.flags.slug
  return Effect.gen(function* () {
    switch (operation._tag) {
      case 'CreateToken': {
        const data: Types.Mutable<
          Parameters<typeof Api.createApiTokenServerFn>[0]['data']
        > = {
          workspaceSlug,
          name: model.tokens.name.trim(),
          scopes: model.tokens.scopes
        }
        if (model.tokens.expiry) {
          data.expiresAt = new Date(`${model.tokens.expiry}Z`).toISOString()
        }
        const result = yield* call(
          () =>
            Api.createApiTokenServerFn({
              data
            }),
          m.api_token_create_failed()
        )
        return {
          _tag: 'Secret',
          secret: result.token,
          notice: m.token_created_copy_now()
        } satisfies Result
      }
      case 'ReplaceToken': {
        const result = yield* call(
          () =>
            Api.replaceApiTokenServerFn({
              data: {
                workspaceSlug,
                tokenId: operation.id,
                scopes: model.tokens.scopes,
                overlapSeconds: Number(model.tokens.overlap)
              }
            }),
          m.token_replace_failed()
        )
        return {
          _tag: 'Secret',
          secret: result.token,
          notice: m.token_update_clients_expiry({
            time: formatTimestampOr(result.previousTokenExpiresAt, m.never())
          })
        } satisfies Result
      }
      case 'RevokeToken': {
        yield* call(
          () =>
            Api.revokeApiTokenServerFn({
              data: { workspaceSlug, tokenId: operation.id }
            }),
          m.api_token_revoke_failed()
        )
        break
      }
      default: {
        break
      }
    }
    return { _tag: 'Done', notice: m.common_done() } satisfies Result
  })
}

export function form(model: Model, h: H) {
  const selectedScopes = new Set(model.tokens.scopes)
  const replacement =
    model.page._tag === 'api-tokens'
      ? model.page.data.tokens.find((token) => token.id === model.tokens.replacement)
      : undefined
  const scopes = replacement?.scopes ?? apiTokenScopes
  return h.form(
    [
      h.Attribute(
        'aria-label',
        replacement
          ? m.action_replace_named({ name: replacement.name })
          : m.form_create_token()
      ),
      h.Class('grid gap-4'),
      h.OnSubmit({
        _tag: 'Perform',
        action: replacement
          ? { _tag: 'ReplaceToken', id: replacement.id }
          : { _tag: 'CreateToken' }
      })
    ],
    [
      ...(replacement
        ? [
            h.p([], [m.token_replacement_guidance()]),
            h.p(
              [],
              [
                m.token_replacement_inherits_expiry(),
                formatTimestampOr(replacement.expiresAt, m.never())
              ]
            )
          ]
        : [
            field(
              h,
              'token-name',
              m.form_token_name(),
              model.tokens.name,
              (value) => ({
                _tag: 'TokenField',
                field: 'name',
                value
              }),
              'text',
              false,
              m.form_token_placeholder()
            )
          ]),
      h.fieldset(
        [],
        [
          h.legend([], [replacement ? m.token_replacement_scopes() : m.scopes()]),
          ...scopes.map((scope) =>
            checkbox(
              h,
              scope,
              selectedScopes.has(scope),
              { _tag: 'TokenScope', scope },
              model.pending
            )
          )
        ]
      ),
      replacement
        ? field(
            h,
            'replacement-overlap',
            m.form_overlap(),
            model.tokens.overlap,
            (value) => ({ _tag: 'TokenField', field: 'overlap', value }),
            'number'
          )
        : field(
            h,
            'token-expiry',
            m.form_expiry(),
            model.tokens.expiry,
            (value) => ({ _tag: 'TokenField', field: 'expiry', value }),
            'datetime-local'
          ),
      h.p(
        [h.Class('text-sm text-muted-foreground')],
        [replacement ? m.token_overlap_hint() : m.form_expiry_hint()]
      ),
      ...(replacement ? [h.p([], [m.token_keep_remove_scopes()])] : []),
      action(
        h,
        model,
        replacement ? m.token_create_replacement() : m.form_create_token(),
        replacement
          ? { _tag: 'ReplaceToken', id: replacement.id }
          : { _tag: 'CreateToken' }
      ),
      secret(h, model),
      feedback(h, model)
    ]
  )
}

export function view(model: Model, h: H) {
  if (model.page._tag !== 'api-tokens') {
    return h.div([], [])
  }
  const data = model.page.data
  const fields = [
    { id: 'name', label: m.developer_list_name(), kind: 'text' as const },
    { id: 'prefix', label: m.token_prefix(), kind: 'text' as const },
    { id: 'createdAt', label: m.token_created_label(), kind: 'date' as const },
    {
      id: 'status',
      label: m.common_status(),
      kind: 'select' as const,
      options: [
        { value: 'active', label: m.developer_list_active() },
        { value: 'expired', label: m.developer_list_expired() },
        { value: 'replaced', label: m.developer_list_replaced() }
      ]
    },
    { id: 'scopes', label: m.scopes(), kind: 'text' as const },
    { id: 'lastUsedAt', label: m.token_last_used_label(), kind: 'date' as const },
    { id: 'expiresAt', label: m.form_expiry(), kind: 'date' as const }
  ]
  const rows = paged(
    model,
    'api-tokens',
    fields,
    data.tokens,
    (token, key) => {
      switch (key) {
        case 'status': {
          if (token.replacedByTokenId !== null) {
            return 'replaced'
          }
          return token.expiresAt !== null && Date.parse(token.expiresAt) <= Date.now()
            ? 'expired'
            : 'active'
        }
        case 'prefix': {
          return token.prefix
        }
        case 'createdAt': {
          return token.createdAt
        }
        case 'scopes': {
          return token.scopes.join(' ')
        }
        case 'lastUsedAt': {
          return token.lastUsedAt
        }
        case 'expiresAt': {
          return token.expiresAt
        }
        default: {
          return token.name
        }
      }
    },
    (token) => `${token.name} ${token.prefix}`
  )
  return h.div(
    [h.Class('grid gap-6')],
    [
      heading(
        h,
        m.nav_api_tokens(),
        m.page_api_tokens_description(),
        viewerCan(data.viewer, { apiToken: ['create'] })
          ? [button(h, m.tokens_create_title(), { _tag: 'Open', dialog: 'token' })]
          : []
      ),
      listControls(h, model, 'api-tokens', fields, m.developer_list_search_tokens()),
      ...(data.tokens.length === 0
        ? [
            h.p([], [m.empty_no_tokens()]),
            ...(viewerCan(data.viewer, { apiToken: ['create'] })
              ? [h.p([], [m.empty_create_token()])]
              : [])
          ]
        : []),
      ...(data.tokens.length > 0 && rows.items.length === 0
        ? [h.p([], [m.developer_list_no_matching_tokens()])]
        : []),
      ...(viewerCan(data.viewer, { apiToken: ['create'] })
        ? []
        : [h.p([], [m.token_mint_denied()])]),
      ...(viewerCan(data.viewer, { apiToken: ['revoke'] })
        ? []
        : [h.p([], [m.token_revoke_denied()])]),
      h.ul(
        [],
        rows.items.map((token) =>
          row(
            h,
            token.name,
            `${token.prefix}… · ${token.scopes.join(', ')} · ${formatTimestampOr(token.lastUsedAt, m.never())}`,
            [
              actionMenu(
                h,
                `token-actions-${token.id}`,
                m.members_more_actions({ name: token.name }),
                [
                  ...(viewerCan(data.viewer, { apiToken: ['create'] }) &&
                  token.replacedByTokenId === null &&
                  (token.expiresAt === null || Date.parse(token.expiresAt) > Date.now())
                    ? [
                        {
                          label: m.action_replace(),
                          message: { _tag: 'Replace' as const, id: token.id },
                          disabled: model.pending
                        }
                      ]
                    : []),
                  ...(viewerCan(data.viewer, { apiToken: ['revoke'] })
                    ? [
                        {
                          label: m.action_revoke(),
                          message: {
                            _tag: 'Confirm' as const,
                            action: { _tag: 'RevokeToken' as const, id: token.id },
                            title: m.action_revoke()
                          },
                          disabled: model.pending
                        }
                      ]
                    : [])
                ]
              ),
              h.p(
                [h.Class('text-sm')],
                [
                  m.form_expiry(),
                  ': ',
                  formatTimestampOr(token.expiresAt, m.never()),
                  ...(token.expiresAt !== null &&
                  Date.parse(token.expiresAt) <= Date.now()
                    ? [` · ${m.developer_list_expired()}`]
                    : []),
                  ...(token.replacedByTokenId === null
                    ? []
                    : [` · ${m.token_replacement_issued()}`])
                ]
              )
            ]
          )
        )
      ),
      pagination(h, model, rows.pages),
      ...(model.tokens.replacement
        ? [
            panel(h, m.action_replace(), [
              form(model, h),
              button(h, m.common_cancel(), { _tag: 'Close' })
            ])
          ]
        : []),
      ...(model.tokens.replacement ? [] : [feedback(h, model)])
    ]
  )
}
