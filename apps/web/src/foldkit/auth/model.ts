import { Schema } from 'effect'

export const Page = Schema.Literals([
  'sign-in',
  'sign-up',
  'forgot-password',
  'reset-password',
  'two-factor',
  'email-code',
  'verify-email',
  'magic-link',
  'verify-authentication'
])
export type Page = typeof Page.Type

export const Flags = Schema.Struct({
  page: Page,
  search: Schema.String,
  turnstileSiteKey: Schema.NullOr(Schema.String),
  socialProviders: Schema.Array(Schema.Literals(['github', 'google'])),
  emailVerified: Schema.Boolean,
  twoFactorEnabled: Schema.Boolean,
  recovering: Schema.Boolean,
  locale: Schema.Literals(['en', 'nb']),
  authenticated: Schema.Boolean
})
export type Flags = typeof Flags.Type

export const Fields = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  password: Schema.String,
  confirm: Schema.String,
  code: Schema.String
})
export const Mode = Schema.Literals(['password', 'link', 'totp', 'backup'])
export const Stage = Schema.Literals(['form', 'code', 'sent'])
export const Model = Schema.Struct({
  flags: Flags,
  fields: Fields,
  mode: Mode,
  stage: Stage,
  ready: Schema.Boolean,
  lastLoginMethod: Schema.NullOr(Schema.String),
  pending: Schema.Boolean,
  autofillPending: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  notice: Schema.NullOr(Schema.String),
  trustDevice: Schema.Boolean,
  token: Schema.NullOr(Schema.String),
  challengeRevision: Schema.Number,
  request: Schema.Number,
  cooldown: Schema.Number,
  demoOpen: Schema.Boolean,
  localeTarget: Schema.NullOr(Schema.Literals(['en', 'nb']))
})
export type Model = typeof Model.Type

export const Operation = Schema.Literals([
  'password',
  'sign-up',
  'magic-link',
  'reset-link',
  'reset-code',
  'send-code',
  'verify-code',
  'reset-password',
  'totp',
  'backup',
  'passkey',
  'github',
  'google',
  'verify-current-password',
  'verify-current-passkey'
])
export type Operation = typeof Operation.Type
export const Message = Schema.TaggedUnion({
  ChangedDigit: { index: Schema.Number, value: Schema.String },
  PressedDigit: {
    index: Schema.Number,
    key: Schema.Literals(['Backspace', 'ArrowLeft', 'ArrowRight'])
  },
  FocusedDigit: { index: Schema.Number },
  Ready: { lastLoginMethod: Schema.NullOr(Schema.String) },
  AutofillPending: { pending: Schema.Boolean },
  ChangedField: {
    field: Schema.Literals(['name', 'email', 'password', 'confirm', 'code']),
    value: Schema.String
  },
  ChangedMode: { mode: Mode },
  ChangedTrust: { value: Schema.Boolean },
  ChangedChallenge: { token: Schema.NullOr(Schema.String) },
  Submitted: {},
  Requested: { operation: Operation },
  Failed: { request: Schema.Number, error: Schema.String },
  Sent: { request: Schema.Number, stage: Stage },
  EnrollmentRequired: { request: Schema.Number },
  Tick: {},
  DifferentEmail: {},
  DemoOpened: {},
  DemoClosed: {},
  DemoFilled: { member: Schema.Boolean },
  CompletedDom: {},
  SelectedLocale: { locale: Schema.Literals(['en', 'nb']) },
  ConfirmedLocale: {},
  CancelledLocale: {}
})
export type Message = typeof Message.Type

export function initialModel(flags: Flags): Model {
  return {
    flags,
    fields: { name: '', email: '', password: '', confirm: '', code: '' },
    mode: flags.page === 'two-factor' ? 'totp' : 'password',
    stage: 'form',
    ready: false,
    lastLoginMethod: null,
    pending: false,
    autofillPending: false,
    error: null,
    notice: null,
    trustDevice: false,
    token: null,
    challengeRevision: 0,
    request: 0,
    cooldown: 0,
    demoOpen: false,
    localeTarget: null
  }
}

export function submitOperation(model: Model): Operation {
  switch (model.flags.page) {
    case 'sign-in': {
      return model.mode === 'link' ? 'magic-link' : 'password'
    }
    case 'sign-up': {
      return 'sign-up'
    }
    case 'forgot-password': {
      return model.stage === 'code' ? 'verify-code' : 'reset-link'
    }
    case 'reset-password': {
      return 'reset-password'
    }
    case 'two-factor': {
      return model.mode === 'backup' ? 'backup' : 'totp'
    }
    case 'email-code':
    case 'verify-email': {
      return model.stage === 'code' ? 'verify-code' : 'send-code'
    }
    case 'magic-link': {
      return 'magic-link'
    }
    case 'verify-authentication': {
      return 'verify-current-password'
    }
  }
}
