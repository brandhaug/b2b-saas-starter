import { type Html, type HtmlBuilder } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import { safeRedirect } from '@/lib/utils'
import { DEMO_CREDENTIALS, DEMO_MEMBER_CREDENTIALS } from '@/lib/demo-workspace'
import { Message, submitOperation, type Model } from './model'
import { validation } from './update'
import { emailValidator, passwordValidator } from '@/components/auth/auth-validators'
import { needsChallenge } from './resources'
import { loginMethodLabel } from '@/components/auth/social-provider-labels'
import { Option } from 'effect'
import { digitId } from './commands'
import {
  buttonClass,
  primaryButtonClass,
  secondaryButtonClass,
  textButtonClass,
  icon,
  localeFlag
} from '../shared/view'

type H = HtmlBuilder<Message>
const linkClass =
  'inline-flex items-center text-sm text-primary underline underline-offset-4 max-md:min-h-11'

function link<M>(h: HtmlBuilder<M>, href: string, label: string): Html {
  return h.a([h.Href(href), h.Class(linkClass)], [label])
}

function action(
  h: H,
  model: Model,
  label: string,
  message: Message,
  id?: string,
  className = buttonClass
): Html {
  return h.button(
    [
      h.Type('button'),
      h.Class(className),
      h.Disabled(
        !model.ready ||
          model.pending ||
          (message._tag === 'Requested' &&
            message.operation === 'passkey' &&
            model.autofillPending)
      ),
      h.OnClick(message),
      ...(id ? [h.Id(id)] : [])
    ],
    [
      message._tag === 'Requested' && message.operation === 'passkey'
        ? icon(h, 'fingerprint')
        : null,
      label
    ]
  )
}

function field(
  h: H,
  model: Model,
  name: keyof Model['fields'],
  label: string,
  type = 'text',
  autocomplete = ''
): Html {
  const numeric = name === 'code' && model.mode !== 'backup'
  if (numeric) {
    return h.div(
      [h.Class('grid gap-2')],
      [
        h.label([h.For('code'), h.Class('text-base font-medium md:text-sm')], [label]),
        h.div(
          [h.Class('flex gap-2')],
          Array.from({ length: 6 }, (_, index) =>
            h.input([
              h.Id(digitId(index)),
              h.Type('text'),
              h.InputMode('numeric'),
              h.Autocomplete(index === 0 ? 'one-time-code' : 'off'),
              h.Attribute('maxlength', '6'),
              h.AriaLabel(m.public_auth_otp_digit({ index: index + 1, length: 6 })),
              h.Class(
                'h-9 w-10 rounded-md border border-input bg-card px-0 text-center font-mono text-lg outline-none focus-visible:ring-2 focus-visible:ring-ring'
              ),
              h.Value(model.fields.code[index] ?? ''),
              h.Disabled(model.pending),
              h.OnInput((value) => Message.cases.ChangedDigit.make({ index, value })),
              h.OnFocus(Message.cases.FocusedDigit.make({ index })),
              h.OnKeyDownPreventDefault((key) =>
                key === 'Backspace' || key === 'ArrowLeft' || key === 'ArrowRight'
                  ? Option.some(Message.cases.PressedDigit.make({ index, key }))
                  : Option.none()
              )
            ])
          )
        )
      ]
    )
  }
  let error: string | undefined
  if (model.fields[name] !== '') {
    if (name === 'name' && !model.fields.name.trim()) {
      error = m.name_required()
    }
    if (name === 'email') {
      error = emailValidator({ value: model.fields.email })
    }
    if (name === 'password') {
      error = passwordValidator({ value: model.fields.password })
    }
    if (name === 'confirm' && model.fields.confirm !== model.fields.password) {
      error = m.passwords_do_not_match()
    }
  }
  return h.div(
    [h.Class('grid gap-2')],
    [
      h.label([h.For(name), h.Class('text-base font-medium md:text-sm')], [label]),
      h.input([
        h.Id(name),
        h.Name(name),
        h.Type(type),
        h.Value(model.fields[name]),
        h.Required(true),
        h.Autocomplete(autocomplete),
        ...(name === 'email' ? [h.Placeholder(m.email_placeholder())] : []),
        ...(name === 'name' ? [h.Placeholder(m.name_placeholder())] : []),
        ...(name === 'code' && model.mode === 'backup'
          ? [h.Placeholder(m.backup_code_placeholder())]
          : []),
        ...(error
          ? [
              h.Attribute('aria-invalid', 'true'),
              h.Attribute('aria-describedby', `${name}-error`)
            ]
          : []),
        h.Class(
          'h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9 md:text-sm'
        ),
        h.OnInput((value) =>
          Message.cases.ChangedField.make({
            field: name,
            value
          })
        )
      ]),
      error
        ? h.p([h.Id(`${name}-error`), h.Class('text-sm text-destructive')], [error])
        : null
    ]
  )
}

export function copy(model: Model) {
  switch (model.flags.page) {
    case 'sign-in': {
      return model.mode === 'link'
        ? {
            title: m.sign_in_with_email_link(),
            description: m.email_link_description(),
            submit: m.email_me_sign_in_link()
          }
        : {
            title: m.form_sign_in(),
            description: m.sign_in_description(),
            submit: m.continue_action()
          }
    }
    case 'sign-up': {
      return {
        title: m.create_your_account(),
        description: m.sign_up_description(),
        submit: m.form_create_account()
      }
    }
    case 'forgot-password': {
      return {
        title: model.stage === 'code' ? m.enter_your_code() : m.reset_your_password(),
        description: m.reset_password_description(),
        submit:
          model.stage === 'code' ? m.form_reset_password() : m.form_send_reset_link()
      }
    }
    case 'reset-password': {
      return {
        title: m.choose_new_password(),
        description: m.reset_sessions_description(),
        submit: m.form_reset_password()
      }
    }
    case 'two-factor': {
      return {
        title: m.two_factor_verification(),
        description:
          model.mode === 'backup'
            ? m.backup_code_description()
            : m.authenticator_code_description(),
        submit: m.form_verify_sign_in()
      }
    }
    case 'email-code': {
      return {
        title: model.stage === 'code' ? m.enter_your_code() : m.form_email_code(),
        description: m.public_auth_email_code_description(),
        submit: model.stage === 'code' ? m.form_verify_sign_in() : m.form_email_code()
      }
    }
    case 'verify-email': {
      return {
        title: m.verify_with_code(),
        description: m.email_verification_invalid(),
        submit: model.stage === 'code' ? m.verify_email() : m.form_email_code()
      }
    }
    case 'magic-link': {
      return {
        title: m.public_auth_magic_link_unusable(),
        description: m.public_auth_magic_link_invalid(),
        submit: ''
      }
    }
    case 'verify-authentication': {
      return {
        title: m.security_verify_title(),
        description:
          new URLSearchParams(model.flags.search).get('recent') === 'true'
            ? m.security_recent_authentication_required()
            : m.security_authentication_required(),
        submit: model.flags.twoFactorEnabled
          ? m.security_verify_continue()
          : m.security_confirm_password()
      }
    }
  }
}

function pendingLabel(model: Model): string {
  const page = model.flags.page
  if (page === 'sign-in' && model.mode === 'password') {
    return m.signing_in()
  }
  if (page === 'sign-up') {
    return m.creating_account()
  }
  if (
    page === 'reset-password' ||
    (page === 'forgot-password' && model.stage === 'code')
  ) {
    return m.resetting()
  }
  if (
    model.stage === 'form' &&
    (page === 'forgot-password' || page === 'email-code' || model.mode === 'link')
  ) {
    return m.sending()
  }
  return m.verifying()
}

function demo(h: H, model: Model): Html {
  return h.dialog(
    [
      h.Id('demo-credentials'),
      h.Attribute('aria-labelledby', 'demo-title'),
      h.Class(
        'fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-lg border-l border-border bg-background p-6 text-foreground backdrop:bg-overlay/80'
      )
    ],
    [
      h.h2(
        [h.Id('demo-title'), h.Class('mb-6 text-lg font-semibold')],
        [m.auth_demo_credentials()]
      ),
      h.div(
        [h.Class('grid gap-4')],
        [
          h.p(
            [h.Class('text-sm text-muted-foreground')],
            [
              m.public_auth_seeded_database_hint(),
              ' ',
              `${DEMO_CREDENTIALS.email} / ${DEMO_CREDENTIALS.password}`
            ]
          ),
          action(
            h,
            model,
            m.auth_demo_fill_owner(),
            Message.cases.DemoFilled.make({ member: false })
          ),
          action(
            h,
            model,
            m.auth_demo_fill_member(),
            Message.cases.DemoFilled.make({ member: true })
          ),
          h.p(
            [h.Class('text-sm text-muted-foreground')],
            [
              m.public_auth_member_hint(),
              ' ',
              `${DEMO_MEMBER_CREDENTIALS.email} / ${DEMO_MEMBER_CREDENTIALS.password}`
            ]
          ),
          link(h, '/workspaces/starter-lab', m.public_auth_open_seeded_workspace()),
          action(h, model, m.common_close(), Message.cases.DemoClosed.make({}))
        ]
      )
    ]
  )
}

export function view(model: Model, h: H): Html {
  const { page } = model.flags
  const search = new URLSearchParams(model.flags.search)
  const carried = search.get('redirect')
    ? `?redirect=${encodeURIComponent(search.get('redirect') ?? '')}`
    : ''
  const text = copy(model)
  const entry = page === 'sign-in' || page === 'sign-up'
  const fields: Array<Html> = []
  const footer: Array<Html> = []
  let title = text.title
  let description = text.description
  let notice: string | null = model.notice
  let showForm = true

  if (page === 'magic-link') {
    showForm = false
    footer.push(
      h.p(
        [h.Class('text-sm text-muted-foreground')],
        [m.public_auth_magic_link_existing()]
      ),
      link(h, '/sign-in', m.public_auth_magic_link_request())
    )
  } else if (
    page === 'reset-password' &&
    (!search.get('token') || search.has('error'))
  ) {
    title = m.reset_link_unusable()
    description = m.reset_link_invalid()
    showForm = false
    footer.push(link(h, '/forgot-password', m.request_new_reset_link()))
  } else if (page === 'verify-email' && !search.has('error')) {
    title = model.flags.emailVerified
      ? m.email_verified()
      : m.auth_design_email_verification_pending()
    description = model.flags.emailVerified
      ? m.email_verified_ready()
      : m.auth_design_email_verification_pending_description()
    showForm = false
    footer.push(
      link(
        h,
        safeRedirect(search.get('redirect') ?? undefined),
        search.get('redirect') ? m.continue_action() : m.go_to_workspaces()
      )
    )
  } else if (model.stage === 'sent') {
    showForm = false
    notice =
      page === 'forgot-password'
        ? m.reset_link_sent_notice()
        : m.sign_in_link_sent_notice()
  } else {
    if (page === 'verify-email' && search.has('error')) {
      description = m.email_verification_failed()
      footer.push(h.p([], [m.email_verification_still_signed_in()]))
    }
    if (page === 'verify-authentication') {
      fields.push(
        field(h, model, 'password', m.form_password(), 'password', 'current-password')
      )
      if (model.flags.twoFactorEnabled) {
        fields.push(
          field(
            h,
            model,
            'code',
            m.security_authenticator_code(),
            'text',
            'one-time-code'
          )
        )
      }
      notice ??= model.flags.recovering ? m.security_recovery_notice() : null
      footer.push(
        action(
          h,
          model,
          m.security_verify_passkey(),
          Message.cases.Requested.make({ operation: 'verify-current-passkey' })
        ),
        link(h, `/account${carried}`, m.security_manage_factors()),
        link(h, '/forgot-password', m.forgot_password()),
        h.p([h.Class('text-sm text-muted-foreground')], [m.security_recovery_help()])
      )
    }
    if ((page === 'sign-in' && model.mode === 'password') || page === 'sign-up') {
      if (model.lastLoginMethod !== null) {
        fields.push(
          h.p(
            [h.Class('text-xs text-muted-foreground')],
            [
              m.public_auth_last_signed_in_with({
                method: loginMethodLabel(model.lastLoginMethod)
              })
            ]
          )
        )
      }
      for (const provider of model.flags.socialProviders) {
        fields.push(
          action(
            h,
            model,
            m.public_auth_continue_with_provider({
              provider: provider === 'github' ? 'GitHub' : 'Google'
            }),
            Message.cases.Requested.make({ operation: provider })
          )
        )
      }
      if (model.flags.socialProviders.length > 0) {
        fields.push(
          h.p([], [m.social_sign_in_description()]),
          h.div(
            [h.Class('flex items-center gap-3 text-sm text-muted-foreground')],
            [
              h.span([h.Class('h-px flex-1 bg-border'), h.AriaHidden(true)], []),
              m.or_continue_with_email(),
              h.span([h.Class('h-px flex-1 bg-border'), h.AriaHidden(true)], [])
            ]
          )
        )
      }
    }
    if (page === 'sign-up') {
      fields.push(field(h, model, 'name', m.form_name(), 'text', 'name'))
    }
    if (
      model.stage !== 'code' &&
      ['sign-in', 'sign-up', 'forgot-password', 'email-code', 'verify-email'].includes(
        page
      )
    ) {
      fields.push(
        field(
          h,
          model,
          'email',
          m.form_email(),
          'email',
          page === 'sign-in' ? 'email webauthn' : 'email'
        )
      )
    }
    if (model.stage === 'code' || page === 'two-factor') {
      fields.push(
        field(
          h,
          model,
          'code',
          model.mode === 'backup' ? m.form_backup_code() : m.form_verification_code(),
          'text',
          model.mode === 'backup' ? 'off' : 'one-time-code'
        )
      )
    }
    if (model.stage === 'code') {
      notice = model.fields.email
        ? m.public_auth_email_code_sent_to({ email: model.fields.email })
        : m.public_auth_email_code_sent()
      if (page === 'forgot-password') {
        notice = m.reset_code_sent_notice()
      }
    }
    if (
      (page === 'sign-in' && model.mode === 'password') ||
      page === 'sign-up' ||
      page === 'reset-password' ||
      (page === 'forgot-password' && model.stage === 'code')
    ) {
      fields.push(
        field(
          h,
          model,
          'password',
          page === 'reset-password' || page === 'forgot-password'
            ? m.form_new_password()
            : m.form_password(),
          'password',
          page === 'sign-in' ? 'current-password' : 'new-password'
        )
      )
    }
    if (
      page === 'reset-password' ||
      (page === 'forgot-password' && model.stage === 'code')
    ) {
      fields.push(
        field(
          h,
          model,
          'confirm',
          m.form_confirm_password(),
          'password',
          'new-password'
        )
      )
    }
    if (page === 'two-factor') {
      fields.push(
        h.label(
          [h.For('trust-device'), h.Class('flex items-center gap-2 text-sm')],
          [
            h.input([
              h.Id('trust-device'),
              h.Type('checkbox'),
              h.Checked(model.trustDevice),
              h.OnClick(Message.cases.ChangedTrust.make({ value: !model.trustDevice }))
            ]),
            m.trust_device()
          ]
        )
      )
    }
    if (needsChallenge(model)) {
      fields.push(h.div([h.Id('auth-turnstile'), h.Class('flex justify-center')], []))
    }
  }

  if (page === 'sign-in') {
    const modeAction = action(
      h,
      model,
      model.mode === 'password'
        ? m.auth_email_link()
        : m.public_auth_sign_in_with_password_instead(),
      Message.cases.ChangedMode.make({
        mode: model.mode === 'password' ? 'link' : 'password'
      }),
      undefined,
      textButtonClass
    )
    if (model.mode === 'password') {
      footer.push(
        h.div(
          [h.Class('grid gap-2')],
          [
            action(
              h,
              model,
              m.public_auth_sign_in_with_passkey(),
              Message.cases.Requested.make({ operation: 'passkey' }),
              undefined,
              secondaryButtonClass
            ),
            h.div(
              [h.Class('flex flex-wrap items-center justify-center gap-x-6 gap-y-2')],
              [
                modeAction,
                link(h, `/sign-in/email-code${carried}`, m.auth_email_code())
              ]
            )
          ]
        ),
        h.div(
          [h.Class('flex justify-end')],
          [link(h, '/forgot-password', m.forgot_password())]
        )
      )
    } else {
      footer.push(modeAction)
    }
    footer.push(
      action(
        h,
        model,
        m.auth_view_demo_credentials(),
        Message.cases.DemoOpened.make({}),
        'demo-credentials-trigger',
        textButtonClass
      ),
      h.p(
        [h.Class('text-center text-sm text-muted-foreground')],
        [m.no_account_yet(), ' ', link(h, `/sign-up${carried}`, m.create_one())]
      )
    )
    if (search.get('error') === 'two_factor_required') {
      notice = m.public_auth_two_factor_required()
    }
    if (search.get('error') === 'social_link_authentication_required') {
      notice = m.security_social_link_authentication_required()
      footer.push(
        link(
          h,
          `/verify-authentication?recent=true&redirect=${encodeURIComponent(`/sign-in${carried}`)}`,
          m.security_verify_continue()
        )
      )
    }
  } else if (page === 'two-factor') {
    footer.push(
      action(
        h,
        model,
        model.mode === 'backup' ? m.use_authenticator_code() : m.use_backup_code(),
        Message.cases.ChangedMode.make({
          mode: model.mode === 'backup' ? 'totp' : 'backup'
        })
      )
    )
  } else if (page !== 'magic-link' && page !== 'verify-email') {
    if (page === 'sign-up') {
      footer.push(h.p([], [m.already_have_account()]))
    }
    if (page === 'email-code') {
      footer.push(h.p([], [m.public_auth_prefer_password()]))
    }
    if (page === 'forgot-password') {
      footer.push(h.p([], [m.remembered_it()]))
    }
    footer.push(
      link(
        h,
        `/sign-in${carried}`,
        page === 'email-code' ? m.public_auth_sign_in_that_way() : m.form_sign_in()
      )
    )
  }

  if (page === 'forgot-password' && model.stage === 'form') {
    footer.unshift(
      action(
        h,
        model,
        m.email_code_instead(),
        Message.cases.Requested.make({ operation: 'reset-code' })
      )
    )
  }
  if (model.stage === 'code') {
    footer.unshift(
      h.button(
        [
          h.Type('button'),
          h.Class(buttonClass),
          h.Disabled(model.pending || model.cooldown > 0),
          h.OnClick(
            Message.cases.Requested.make({
              operation: page === 'forgot-password' ? 'reset-code' : 'send-code'
            })
          )
        ],
        [
          model.cooldown > 0
            ? m.resend_code_in_seconds({ count: model.cooldown })
            : m.resend_code()
        ]
      ),
      action(
        h,
        model,
        page === 'forgot-password' ? m.use_link_instead() : m.use_different_email(),
        Message.cases.DifferentEmail.make({})
      )
    )
  }
  const content = h.main(
    [
      h.Id('main-content'),
      h.Tabindex(-1),
      h.Class(
        entry
          ? 'w-full outline-none'
          : 'mx-auto grid w-full max-w-md flex-1 place-items-center px-4 py-12 outline-none'
      )
    ],
    [
      h.div(
        [
          h.Class(
            entry
              ? 'grid w-full gap-4'
              : 'grid w-full gap-6 border border-border bg-card p-6'
          )
        ],
        [
          h.div(
            [h.Class('grid gap-1')],
            [
              h.h1(
                [
                  h.Class(
                    entry
                      ? 'text-3xl font-semibold tracking-tight'
                      : 'text-lg font-semibold'
                  )
                ],
                [title]
              ),
              h.p([h.Class('text-sm text-muted-foreground')], [description])
            ]
          ),
          notice
            ? h.p(
                [
                  h.Id('auth-notice'),
                  h.Tabindex(-1),
                  h.Role(
                    page === 'sign-in' && search.has('error') ? 'alert' : 'status'
                  ),
                  h.Class('text-sm text-muted-foreground')
                ],
                [notice]
              )
            : null,
          showForm
            ? h.form(
                [
                  h.Method('post'),
                  h.OnSubmit(Message.cases.Submitted.make({})),
                  h.Class('grid gap-4'),
                  ...(model.ready ? [h.Attribute('data-hydrated', 'true')] : [])
                ],
                [
                  h.fieldset(
                    [h.Disabled(!model.ready || model.pending), h.Class('grid gap-4')],
                    [
                      ...fields,
                      h.button(
                        [
                          h.Type('submit'),
                          h.Attribute('aria-busy', String(model.pending)),
                          h.Disabled(
                            !model.ready ||
                              model.pending ||
                              validation(model, submitOperation(model), false) !==
                                undefined
                          ),
                          h.Class(`${primaryButtonClass} w-full`)
                        ],
                        [
                          h.span(
                            [
                              h.Class('inline-flex size-4 shrink-0'),
                              h.AriaHidden(true)
                            ],
                            [
                              model.pending
                                ? h.span(
                                    [
                                      h.Class(
                                        'size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none'
                                      )
                                    ],
                                    []
                                  )
                                : icon(h, 'key')
                            ]
                          ),
                          text.submit
                        ]
                      ),
                      model.pending
                        ? h.output(
                            [
                              h.Attribute('aria-live', 'polite'),
                              h.Attribute('aria-atomic', 'true'),
                              h.Class('sr-only')
                            ],
                            [pendingLabel(model)]
                          )
                        : null
                    ]
                  ),
                  model.ready
                    ? null
                    : h.output(
                        [h.Class('text-sm text-muted-foreground')],
                        [m.public_auth_initializing()]
                      )
                ]
              )
            : null,
          model.error
            ? h.div(
                [
                  h.Id('auth-error'),
                  h.Tabindex(-1),
                  h.Role('alert'),
                  h.Class(
                    'border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive'
                  )
                ],
                [model.error]
              )
            : null,
          h.div([h.Class(entry ? 'grid gap-4' : 'grid gap-3')], footer),
          entry ? null : link(h, '/help', m.public_meta_support())
        ]
      )
    ]
  )
  const language = h.div(
    [h.Class('relative inline-flex shrink-0')],
    [
      localeFlag(h, model.flags.locale),
      h.select(
        [
          h.Id('auth-locale'),
          h.AriaLabel(m.shell_language()),
          h.Value(model.flags.locale),
          h.Disabled(!model.ready || model.pending),
          h.Class(
            'h-11 w-32 rounded-md border border-input bg-input/30 pl-10 pr-2 text-sm focus-visible:outline-2 focus-visible:outline-ring md:h-9'
          ),
          h.OnChange((value) =>
            value === 'nb' || value === 'en'
              ? Message.cases.SelectedLocale.make({ locale: value })
              : Message.cases.CompletedDom.make({})
          )
        ],
        [h.option([h.Value('en')], ['English']), h.option([h.Value('nb')], ['Norsk'])]
      )
    ]
  )
  const confirmation = h.dialog(
    [
      h.Id('auth-locale-confirm'),
      h.Attribute('aria-labelledby', 'auth-locale-title'),
      h.Role('alertdialog'),
      h.Attribute('aria-describedby', 'auth-locale-description'),
      h.Class(
        'fixed inset-0 m-auto max-w-md border border-border bg-card p-6 text-foreground backdrop:bg-overlay/80'
      )
    ],
    [
      h.h2(
        [h.Id('auth-locale-title'), h.Class('text-lg font-semibold')],
        [m.shell_unsaved_title()]
      ),
      h.p(
        [
          h.Id('auth-locale-description'),
          h.Class('my-4 text-sm text-muted-foreground')
        ],
        [m.shell_unsaved_description()]
      ),
      h.div(
        [h.Class('flex justify-end gap-2')],
        [
          action(h, model, m.shell_cancel(), Message.cases.CancelledLocale.make({})),
          action(h, model, m.shell_switch(), Message.cases.ConfirmedLocale.make({}))
        ]
      )
    ]
  )
  return shell(
    h,
    content,
    entry,
    h.div([], [page === 'sign-in' ? demo(h, model) : null, confirmation]),
    language
  )
}

export function shell<M>(
  h: HtmlBuilder<M>,
  content: Html,
  entry: boolean,
  overlay: Html,
  language: Html = null
): Html {
  return h.div(
    [h.Class('relative isolate flex min-h-dvh flex-col bg-background text-foreground')],
    [
      entry
        ? h.canvas(
            [
              h.Id('auth-light-rays'),
              h.AriaHidden(true),
              h.Class(
                'pointer-events-none absolute inset-0 size-full rotate-180 text-primary opacity-30'
              )
            ],
            []
          )
        : null,
      h.a(
        [
          h.Href('#main-content'),
          h.Class(
            'sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-primary focus:text-primary-foreground'
          )
        ],
        [m.common_skip_to_content()]
      ),
      h.header(
        [
          h.Class(
            'relative mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-6 sm:px-10 lg:px-14'
          )
        ],
        [
          h.a(
            [h.Href('/'), h.Class('inline-flex items-center gap-3')],
            [
              h.img([
                h.Src('/assets/starter-logo.png'),
                h.Alt(''),
                h.Attribute('width', '40'),
                h.Attribute('height', '40'),
                h.Class('size-10 shrink-0')
              ]),
              h.span(
                [h.Class('text-sm font-semibold tracking-tight')],
                ['B2B SaaS Starter']
              )
            ]
          ),
          h.a(
            [
              h.Href('/help'),
              h.Class(
                'text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline max-md:min-h-11 max-md:py-3'
              )
            ],
            [m.public_meta_support()]
          )
        ]
      ),
      entry
        ? h.div(
            [
              h.Class(
                'relative mx-auto grid w-full max-w-7xl flex-1 items-center px-6 py-10 sm:px-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(440px,0.8fr)] lg:gap-20 lg:px-14 lg:py-16'
              )
            ],
            [
              h.section(
                [
                  h.Class(
                    'hidden min-h-140 flex-col justify-between border border-border bg-card/40 p-8 lg:flex xl:p-12'
                  ),
                  h.Attribute('aria-labelledby', 'auth-brand-title')
                ],
                [
                  h.div(
                    [],
                    [
                      h.h2(
                        [
                          h.Id('auth-brand-title'),
                          h.Class(
                            'max-w-lg text-4xl font-semibold leading-tight tracking-tight xl:text-5xl'
                          )
                        ],
                        [m.auth_design_build_on_proof()]
                      ),
                      h.p(
                        [
                          h.Class(
                            'mt-6 max-w-lg text-base leading-7 text-muted-foreground'
                          )
                        ],
                        [m.auth_design_brand_description()]
                      )
                    ]
                  ),
                  h.ul(
                    [
                      h.Class('grid gap-2 border-t border-border pt-6'),
                      h.AriaLabel(m.auth_design_capabilities_label())
                    ],
                    [
                      m.auth_design_capability_auth(),
                      m.auth_design_capability_workspaces(),
                      m.auth_design_capability_audit(),
                      m.auth_design_capability_cloudflare()
                    ].map((item) =>
                      h.li(
                        [
                          h.Class(
                            'flex items-center gap-2 text-sm text-muted-foreground'
                          )
                        ],
                        [h.span([h.Class('text-primary')], [icon(h, 'check')]), item]
                      )
                    )
                  )
                ]
              ),
              h.section(
                [
                  h.Class('mx-auto w-full max-w-md'),
                  h.AriaLabel(m.auth_design_account_access())
                ],
                [content]
              )
            ]
          )
        : content,
      h.footer(
        [
          h.Class(
            'relative mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center justify-between gap-3 border-t border-muted-foreground px-6 py-3 text-sm text-muted-foreground sm:px-10 lg:px-14'
          )
        ],
        [
          h.span([], [m.site_footer_tagline()]),
          h.div(
            [h.Class('flex flex-wrap items-center gap-x-4 gap-y-1')],
            [
              h.a(
                [
                  h.Href('/privacy'),
                  h.Class(
                    'inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline'
                  )
                ],
                [m.privacy()]
              ),
              h.a(
                [
                  h.Href('/terms'),
                  h.Class(
                    'inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline'
                  )
                ],
                [m.terms()]
              ),
              language,
              h.a(
                [
                  h.Href('/'),
                  h.Class(
                    'inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:text-foreground hover:underline'
                  )
                ],
                [m.auth_design_explore_starter(), icon(h, 'external')]
              )
            ]
          )
        ]
      ),
      overlay
    ]
  )
}
