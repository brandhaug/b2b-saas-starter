import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { type HtmlBuilder, type Html } from 'foldkit/html'
import { authClient } from '@/lib/auth-client'
import * as EnrollmentQr from './enrollment-qr'
import { loginMethodLabel as method } from '@/components/auth/social-provider-labels'
import { unwrapAuthResult, type AuthResult } from '@/lib/auth-result'
import { formatTimestamp } from '@/lib/format-date'
import { m } from '@b2b-saas-starter/i18n/messages'
import { call, RequestFailure } from '../server-call'
import { button, confirmation, feedback, field, form, panel, text } from './ui'

const Passkey = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  backedUp: Schema.Boolean,
  createdAt: Schema.String
})
const Session = Schema.Struct({
  token: Schema.String,
  label: Schema.String,
  ipAddress: Schema.String,
  expiresAt: Schema.String
})
const Account = Schema.Struct({
  id: Schema.String,
  providerId: Schema.String,
  createdAt: Schema.String
})
const Rows = Schema.Struct({
  passkeys: Schema.Array(Passkey),
  sessions: Schema.Array(Session),
  accounts: Schema.Array(Account),
  currentToken: Schema.String
})
const Fields = Schema.Struct({
  passkeyName: Schema.String,
  rename: Schema.String,
  enablePassword: Schema.String,
  disablePassword: Schema.String,
  regeneratePassword: Schema.String,
  code: Schema.String,
  name: Schema.String,
  currentPassword: Schema.String,
  newPassword: Schema.String,
  confirmPassword: Schema.String
})
const Operation = Schema.TaggedUnion({
  AddPasskey: {},
  RenamePasskey: { id: Schema.String },
  RemovePasskey: { id: Schema.String, name: Schema.String },
  Unlink: { id: Schema.String, name: Schema.String },
  Revoke: { token: Schema.String, name: Schema.String },
  RevokeOthers: {},
  Enable: {},
  Verify: {},
  Disable: {},
  Regenerate: {},
  Profile: {},
  Password: {}
})
type Operation = typeof Operation.Type
export const Model = Schema.Struct({
  ready: Schema.Boolean,
  pending: Schema.Boolean,
  impersonating: Schema.Boolean,
  enabled: Schema.Boolean,
  fields: Fields,
  rows: Schema.NullOr(Rows),
  error: Schema.NullOr(Schema.String),
  notice: Schema.NullOr(Schema.String),
  confirming: Schema.NullOr(Operation),
  renaming: Schema.NullOr(Schema.String),
  enrollment: Schema.NullOr(
    Schema.Struct({
      totpURI: Schema.String,
      backupCodes: Schema.Array(Schema.String),
      qr: Schema.NullOr(EnrollmentQr.Graphic)
    })
  ),
  backupCodes: Schema.Array(Schema.String)
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: {},
  Changed: {
    field: Schema.Literals([
      'passkeyName',
      'rename',
      'enablePassword',
      'disablePassword',
      'regeneratePassword',
      'code',
      'name',
      'currentPassword',
      'newPassword',
      'confirmPassword'
    ]),
    value: Schema.String
  },
  Requested: { operation: Operation },
  Confirmed: {},
  Cancelled: {},
  RenameOpened: { id: Schema.String, name: Schema.String },
  RenameClosed: {},
  Loaded: { rows: Rows },
  Failed: { error: Schema.String },
  Done: { notice: Schema.NullOr(Schema.String) },
  Enrolled: {
    totpURI: Schema.String,
    backupCodes: Schema.Array(Schema.String),
    qr: Schema.NullOr(EnrollmentQr.Graphic)
  },
  Verified: {},
  Disabled: {},
  Codes: { codes: Schema.Array(Schema.String) },
  CodesDismissed: {}
})
export type Message = typeof Message.Type
const { cases: Msg } = Message

function auth<A>(run: () => Promise<AuthResult<A>>, fallback: string) {
  return call(() => unwrapAuthResult(run, fallback), fallback).pipe(
    Effect.flatMap((data) => {
      if (data === null) {
        return Effect.fail(new RequestFailure({ message: fallback }))
      }
      return Effect.succeed(data)
    })
  )
}
function mutation<A>(run: () => Promise<AuthResult<A>>, fallback: string) {
  return call(() => unwrapAuthResult(run, fallback), fallback)
}
function device(agent: string | null | undefined): string {
  if (!agent) {
    return m.unknown_device()
  }
  if (/iPhone|Android/.test(agent)) {
    return m.mobile_browser()
  }
  if (agent.includes('Macintosh')) {
    return 'Mac'
  }
  if (agent.includes('Windows')) {
    return 'Windows'
  }
  if (agent.includes('Linux')) {
    return 'Linux'
  }
  return m.browser()
}
const load = Effect.fn('AccountSecurity.load')(function* (impersonating: boolean) {
  const current = yield* auth(() => authClient.getSession(), m.load_sessions_failed())
  const sessions = yield* auth(
    () => authClient.listSessions(),
    m.load_sessions_failed()
  )
  const passkeys = impersonating
    ? []
    : yield* auth(() => authClient.passkey.listUserPasskeys(), m.load_passkeys_failed())
  const accounts = impersonating
    ? []
    : yield* auth(() => authClient.listAccounts(), m.load_linked_providers_failed())
  return Msg.Loaded.make({
    rows: {
      currentToken: current.session.token,
      // Better Auth's list uses the adapter's default result limit and has no
      // pagination input. Its bounded result may omit the authenticated device.
      sessions: [
        current.session,
        ...sessions.filter((row) => row.token !== current.session.token)
      ]
        .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((row) => ({
          token: row.token,
          label: device(row.userAgent),
          ipAddress: row.ipAddress ?? '',
          expiresAt: row.expiresAt.toISOString()
        })),
      passkeys: passkeys
        .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((row) => ({
          id: row.id,
          name: row.name || m.passkey(),
          backedUp: row.backedUp,
          createdAt: row.createdAt.toISOString()
        })),
      accounts: accounts.map((row) => ({
        id: row.id,
        providerId: row.providerId,
        createdAt: row.createdAt.toISOString()
      }))
    }
  })
})
const Load = Command.define('AccountSecurity.Load', {
  args: { impersonating: Schema.Boolean },
  messages: [Msg.Loaded, Msg.Failed],
  execute: ({ impersonating }) =>
    load(impersonating).pipe(
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Msg.Failed.make({ error: error.message }))
      )
    )
})
const Execute = Command.define('AccountSecurity.Execute', {
  args: { model: Model, operation: Operation },
  messages: [
    Msg.Loaded,
    Msg.Failed,
    Msg.Enrolled,
    Msg.Verified,
    Msg.Disabled,
    Msg.Codes,
    Msg.Done
  ],
  execute: ({ model, operation }) =>
    Effect.gen(function* () {
      const f = model.fields
      switch (operation._tag) {
        case 'Enable': {
          const data = yield* auth(
            () => authClient.twoFactor.enable({ password: f.enablePassword }),
            m.two_factor_setup_failed()
          )
          if (!('totpURI' in data) || !data.totpURI) {
            return Msg.Failed.make({ error: m.setup_response_incomplete() })
          }
          return Msg.Enrolled.make({
            totpURI: data.totpURI,
            qr: yield* EnrollmentQr.encode(data.totpURI),
            backupCodes: 'backupCodes' in data ? data.backupCodes : []
          })
        }
        case 'Verify': {
          yield* mutation(
            () => authClient.twoFactor.verifyTotp({ code: f.code }),
            m.auth_invalid_code()
          )
          return Msg.Verified.make({})
        }
        case 'Disable': {
          yield* mutation(
            () => authClient.twoFactor.disable({ password: f.disablePassword }),
            m.two_factor_disable_failed()
          )
          return Msg.Disabled.make({})
        }
        case 'Regenerate': {
          const data = yield* auth(
            () =>
              authClient.twoFactor.generateBackupCodes({
                password: f.regeneratePassword
              }),
            m.backup_codes_regenerate_failed()
          )
          return Array.isArray(data.backupCodes) && data.backupCodes.length
            ? Msg.Codes.make({ codes: data.backupCodes })
            : Msg.Failed.make({ error: m.regeneration_response_incomplete() })
        }
        case 'AddPasskey': {
          yield* mutation(
            () =>
              authClient.passkey.addPasskey(
                f.passkeyName.trim() ? { name: f.passkeyName.trim() } : {}
              ),
            m.passkey_add_failed()
          )
          break
        }
        case 'RenamePasskey': {
          yield* mutation(
            () =>
              authClient.passkey.updatePasskey({
                id: operation.id,
                name: f.rename.trim()
              }),
            m.passkey_action_failed()
          )
          break
        }
        case 'RemovePasskey': {
          yield* mutation(
            () => authClient.passkey.deletePasskey({ id: operation.id }),
            m.passkey_action_failed()
          )
          break
        }
        case 'Unlink': {
          yield* mutation(
            () => authClient.unlinkAccount({ accountId: operation.id }),
            m.linked_account_unlink_failed()
          )
          break
        }
        case 'Revoke': {
          yield* mutation(
            () => authClient.revokeSession({ token: operation.token }),
            m.session_action_failed()
          )
          break
        }
        case 'RevokeOthers': {
          yield* mutation(
            () => authClient.revokeOtherSessions(),
            m.session_action_failed()
          )
          break
        }
        case 'Profile': {
          yield* mutation(
            () => authClient.updateUser({ name: f.name.trim() }),
            m.shell_save_error()
          )
          return Msg.Done.make({ notice: m.save_action() })
        }
        case 'Password': {
          yield* mutation(
            () =>
              authClient.changePassword({
                currentPassword: f.currentPassword,
                newPassword: f.newPassword,
                revokeOtherSessions: true
              }),
            m.reset_failed()
          )
          break
        }
      }
      return yield* load(model.impersonating)
    }).pipe(
      Effect.catchTag('RequestFailure', (error) =>
        Effect.succeed(Msg.Failed.make({ error: error.message }))
      )
    )
})
export function init(
  name: string,
  enabled: boolean,
  impersonating: boolean
): Update.Return<Model, Message> {
  return {
    model: {
      ready: false,
      pending: false,
      impersonating,
      enabled,
      fields: {
        passkeyName: '',
        rename: '',
        enablePassword: '',
        disablePassword: '',
        regeneratePassword: '',
        code: '',
        name,
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      },
      rows: null,
      error: null,
      notice: null,
      confirming: null,
      renaming: null,
      enrollment: null,
      backupCodes: []
    },
    commands: [Load({ impersonating })]
  }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Ready': {
      return { model: { ...model, ready: true } }
    }
    case 'Changed': {
      return {
        model: { ...model, fields: { ...model.fields, [message.field]: message.value } }
      }
    }
    case 'RenameOpened': {
      return {
        model: {
          ...model,
          renaming: message.id,
          fields: { ...model.fields, rename: message.name }
        }
      }
    }
    case 'RenameClosed': {
      return { model: { ...model, renaming: null } }
    }
    case 'Cancelled': {
      return model.pending ? { model } : { model: { ...model, confirming: null } }
    }
    case 'Requested': {
      if (
        !model.ready ||
        model.pending ||
        (model.impersonating &&
          !['Revoke', 'RevokeOthers'].includes(message.operation._tag))
      ) {
        return { model }
      }
      if (
        ['RemovePasskey', 'Unlink', 'Revoke', 'RevokeOthers'].includes(
          message.operation._tag
        )
      ) {
        return { model: { ...model, confirming: message.operation, error: null } }
      }
      if (message.operation._tag === 'Verify' && !/^\d{6}$/.test(model.fields.code)) {
        return { model: { ...model, error: m.auth_invalid_code() } }
      }
      if (
        message.operation._tag === 'Password' &&
        model.fields.newPassword !== model.fields.confirmPassword
      ) {
        return { model: { ...model, error: m.passwords_do_not_match() } }
      }
      return {
        model: { ...model, pending: true, error: null },
        commands: [Execute({ model, operation: message.operation })]
      }
    }
    case 'Confirmed': {
      return model.confirming === null || model.pending
        ? { model }
        : {
            model: { ...model, pending: true, error: null },
            commands: [Execute({ model, operation: model.confirming })]
          }
    }
    case 'Failed': {
      return { model: { ...model, ready: true, pending: false, error: message.error } }
    }
    case 'Loaded': {
      return {
        model: {
          ...model,
          ready: true,
          pending: false,
          error: null,
          confirming: null,
          renaming: null,
          rows: message.rows,
          fields: {
            ...model.fields,
            passkeyName: '',
            rename: '',
            currentPassword: '',
            newPassword: '',
            confirmPassword: ''
          }
        }
      }
    }
    case 'Done': {
      return { model: { ...model, pending: false, notice: message.notice } }
    }
    case 'Enrolled': {
      return {
        model: {
          ...model,
          pending: false,
          enrollment: {
            totpURI: message.totpURI,
            backupCodes: message.backupCodes,
            qr: message.qr
          },
          fields: { ...model.fields, enablePassword: '' }
        }
      }
    }
    case 'Verified': {
      return {
        model: {
          ...model,
          pending: false,
          enabled: true,
          enrollment: null,
          fields: { ...model.fields, code: '' },
          notice: m.two_factor_now_on()
        }
      }
    }
    case 'Disabled': {
      return {
        model: {
          ...model,
          pending: false,
          enabled: false,
          fields: { ...model.fields, disablePassword: '' },
          notice: m.auth_two_factor_off()
        }
      }
    }
    case 'Codes': {
      return {
        model: {
          ...model,
          pending: false,
          backupCodes: message.codes,
          fields: { ...model.fields, regeneratePassword: '' }
        }
      }
    }
    case 'CodesDismissed': {
      return { model: { ...model, backupCodes: [] } }
    }
  }
}
function codes(h: HtmlBuilder<Message>, values: ReadonlyArray<string>): Html {
  return h.section(
    [h.AriaLabel(m.backup_codes()), h.Class('grid gap-2 bg-muted p-4')],
    [
      text(h, m.backup_codes_save_once()),
      h.ul(
        [h.Class('flex flex-wrap gap-4')],
        values.map((value) =>
          h.li([], [h.code([h.Class('font-mono text-sm')], [value])])
        )
      )
    ]
  )
}
function request(operation: Operation): Message {
  return { _tag: 'Requested', operation }
}
export function view(
  model: Model,
  h: HtmlBuilder<Message>,
  region: 'all' | 'credentials' | 'sessions' = 'all'
): Html {
  function input(
    key: keyof typeof Fields.Type,
    label: string,
    type = 'text',
    id: string = key
  ): Html {
    const placeholders: Partial<Record<keyof typeof Fields.Type, string>> = {
      passkeyName: m.passkey_name_placeholder(),
      code: m.totp_code_placeholder(),
      name: m.name_placeholder()
    }
    return field(
      h,
      id,
      label,
      model.fields[key],
      (value): Message => ({ _tag: 'Changed', field: key, value }),
      type,
      key !== 'passkeyName',
      placeholders[key] ?? ''
    )
  }
  function passwordForm(
    key: keyof typeof Fields.Type,
    label: string,
    operation: Operation,
    id: string
  ): Html {
    return form(h, request(operation), label, model.pending, model.ready, [
      input(key, m.form_password(), 'password', id)
    ])
  }
  const disabled = model.pending || !model.ready
  const content: Array<Html> = [feedback(h, model.error, model.notice)]
  if (!model.impersonating) {
    content.push(
      panel(h, m.form_name(), '', [
        form(
          h,
          request({ _tag: 'Profile' }),
          m.save_action(),
          model.pending,
          model.ready,
          [input('name', m.form_name())]
        )
      ]),
      panel(h, m.form_password(), '', [
        form(
          h,
          request({ _tag: 'Password' }),
          m.save_action(),
          model.pending,
          model.ready,
          [
            input('currentPassword', m.form_password(), 'password'),
            input('newPassword', m.form_new_password(), 'password'),
            input('confirmPassword', m.form_confirm_password(), 'password')
          ]
        )
      ])
    )
  }
  content.push(
    panel(
      h,
      m.panel_sign_in_methods(),
      m.panel_sign_in_methods_description(),
      model.impersonating
        ? [text(h, m.shell_impersonated_sign_in())]
        : [
            h.ul(
              [h.Class('grid gap-2')],
              (model.rows?.accounts ?? []).map((row) =>
                h.li(
                  [
                    h.Class(
                      'flex flex-wrap items-center justify-between gap-3 border border-border px-3 py-2'
                    )
                  ],
                  [
                    h.div(
                      [],
                      [
                        h.p([h.Class('text-sm')], [method(row.providerId)]),
                        text(
                          h,
                          `${m.linked_label()} ${formatTimestamp(row.createdAt, { dateStyle: 'medium' })}`
                        )
                      ]
                    ),
                    ...(model.rows && model.rows.accounts.length > 1
                      ? [
                          button(
                            h,
                            m.unlink_action(),
                            request({
                              _tag: 'Unlink',
                              id: row.id,
                              name: method(row.providerId)
                            }),
                            disabled,
                            m.unlink_named({ name: method(row.providerId) })
                          )
                        ]
                      : [text(h, m.add_sign_in_method_before_removing())])
                  ]
                )
              )
            )
          ]
    )
  )
  const factor: Array<Html> = []
  if (model.enrollment) {
    const secret = URL.canParse(model.enrollment.totpURI)
      ? (new URL(model.enrollment.totpURI).searchParams.get('secret') ?? '')
      : ''
    factor.push(
      text(h, m.setup_authenticator()),
      h.div(
        [h.Class('flex flex-wrap items-start gap-6')],
        [
          ...(model.enrollment.qr ? [EnrollmentQr.view(model.enrollment.qr, h)] : []),
          h.div(
            [h.Class('grid max-w-xs gap-1')],
            [
              text(h, m.enter_secret_manually()),
              h.code([h.Class('break-all font-mono text-sm')], [secret])
            ]
          )
        ]
      ),
      codes(h, model.enrollment.backupCodes),
      form(
        h,
        request({ _tag: 'Verify' }),
        m.verify_code(),
        model.pending,
        model.ready,
        [input('code', m.form_verification_code(), 'text', 'twofactor-code')]
      )
    )
  } else if (model.enabled) {
    factor.push(
      text(h, m.two_factor_on_description()),
      passwordForm(
        'disablePassword',
        m.turn_off(),
        { _tag: 'Disable' },
        'twofactor-password-off'
      ),
      passwordForm(
        'regeneratePassword',
        m.regenerate_backup_codes(),
        { _tag: 'Regenerate' },
        'twofactor-password-regen'
      )
    )
    if (model.backupCodes.length) {
      factor.push(
        text(h, m.backup_codes_save_all_once()),
        codes(h, model.backupCodes),
        button(h, m.saved_my_codes(), { _tag: 'CodesDismissed' })
      )
    }
  } else {
    factor.push(
      text(h, m.two_factor_off_description()),
      passwordForm(
        'enablePassword',
        m.start_setup(),
        { _tag: 'Enable' },
        'twofactor-password-on'
      )
    )
  }
  content.push(
    panel(
      h,
      m.panel_two_factor(),
      m.panel_two_factor_description(),
      model.impersonating ? [text(h, m.shell_impersonated_two_factor())] : factor
    ),
    panel(
      h,
      m.panel_passkeys(),
      m.panel_passkeys_description(),
      model.impersonating
        ? [text(h, m.shell_impersonated_passkeys())]
        : [
            ...(model.rows?.passkeys.length === 0
              ? [text(h, m.no_passkeys_description())]
              : []),
            h.ul(
              [h.Class('grid gap-2')],
              (model.rows?.passkeys ?? []).map((row) =>
                h.li(
                  [
                    h.Class(
                      'flex flex-wrap items-center gap-3 border border-border px-3 py-2'
                    )
                  ],
                  [
                    h.div(
                      [h.Class('min-w-0 flex-1')],
                      [
                        h.p([h.Class('text-sm')], [row.name]),
                        text(
                          h,
                          `${row.backedUp ? m.synced_passkey() : m.device_passkey()} · ${m.added_label()} ${formatTimestamp(row.createdAt, { dateStyle: 'medium' })}`
                        )
                      ]
                    ),
                    ...(model.renaming === row.id
                      ? [
                          form(
                            h,
                            request({ _tag: 'RenamePasskey', id: row.id }),
                            m.save_action(),
                            model.pending,
                            model.ready,
                            [input('rename', m.new_name())]
                          ),
                          button(
                            h,
                            m.common_cancel(),
                            { _tag: 'RenameClosed' },
                            disabled
                          )
                        ]
                      : [
                          button(
                            h,
                            m.rename_action(),
                            { _tag: 'RenameOpened', id: row.id, name: row.name },
                            disabled,
                            m.rename_passkey_named({ name: row.name })
                          )
                        ]),
                    button(
                      h,
                      m.action_remove(),
                      request({ _tag: 'RemovePasskey', id: row.id, name: row.name }),
                      disabled,
                      m.remove_passkey_named({ name: row.name })
                    )
                  ]
                )
              )
            ),
            form(
              h,
              request({ _tag: 'AddPasskey' }),
              m.add_passkey(),
              model.pending,
              model.ready,
              [input('passkeyName', m.form_passkey_name(), 'text', 'passkey-name')]
            ),
            text(h, m.passkey_browser_prompt())
          ]
    )
  )
  const sessions = panel(h, m.active_sessions(), m.active_sessions_description(), [
    ...(model.rows?.sessions.some((row) => row.token !== model.rows?.currentToken)
      ? [
          button(
            h,
            m.auth_sign_out_everywhere(),
            request({ _tag: 'RevokeOthers' }),
            disabled
          )
        ]
      : []),
    h.ul(
      [h.Class('grid gap-2')],
      (model.rows?.sessions ?? []).map((row) =>
        h.li(
          [
            h.Class(
              'flex flex-wrap items-center justify-between gap-3 border border-border px-3 py-2'
            )
          ],
          [
            h.div(
              [],
              [
                h.p(
                  [h.Class('text-sm')],
                  [
                    row.label,
                    ...(row.token === model.rows?.currentToken
                      ? [
                          h.span(
                            [h.Class('text-muted-foreground')],
                            [`· ${m.this_device()}`]
                          )
                        ]
                      : [])
                  ]
                ),
                text(
                  h,
                  `${row.ipAddress} · ${m.expires_label()} ${formatTimestamp(row.expiresAt, { dateStyle: 'medium' })}`
                )
              ]
            ),
            ...(row.token === model.rows?.currentToken
              ? []
              : [
                  button(
                    h,
                    m.action_revoke(),
                    request({ _tag: 'Revoke', token: row.token, name: row.label }),
                    disabled,
                    m.revoke_session_named({ name: row.label })
                  )
                ])
          ]
        )
      )
    )
  ])
  const rendered = region === 'sessions' ? [sessions] : [...content]
  if (region === 'all') {
    rendered.push(sessions)
  }
  const sessionConfirmation =
    model.confirming?._tag === 'Revoke' || model.confirming?._tag === 'RevokeOthers'
  const showConfirmation =
    region === 'all' ||
    (region === 'sessions' ? sessionConfirmation : !sessionConfirmation)
  if (model.confirming && showConfirmation) {
    const op = model.confirming
    let title = m.auth_sign_out_everywhere()
    let description = m.public_auth_session_signed_out()
    if (model.confirming._tag === 'RevokeOthers') {
      description = m.other_sessions_revoked()
    }
    let label = m.sign_out()
    if (op._tag === 'RemovePasskey') {
      title = m.remove_passkey_named({ name: op.name })
      description = m.public_auth_remove_passkey_description()
      label = m.remove_passkey_action()
    } else if (op._tag === 'Unlink') {
      title = m.unlink_named({ name: op.name })
      description = m.provider_unlinked_description()
      label = m.unlink_action()
    } else if (op._tag === 'Revoke') {
      title = m.revoke_session_named({ name: op.name })
      label = m.revoke_session_action()
    }
    rendered.push(
      confirmation(
        h,
        title,
        description,
        { _tag: 'Confirmed' },
        { _tag: 'Cancelled' },
        model.pending,
        model.error,
        label
      )
    )
  }
  return h.div([h.Class('grid gap-6')], rendered)
}
