import { type Update } from 'foldkit'
import { m } from '@b2b-saas-starter/i18n/messages'
import { emailValidator, passwordValidator } from '@/components/auth/auth-validators'
import {
  sixDigitCodeValidator,
  backupCodeValidator
} from '@/components/auth/auth-client-ports'
import { DEMO_CREDENTIALS, DEMO_MEMBER_CREDENTIALS } from '@/lib/demo-workspace'
import { ChangeLocale, Exchange, Focus, Ready, SelectDigit, digitId } from './commands'
import {
  initialModel,
  submitOperation,
  type Flags,
  type Message,
  type Model,
  type Operation
} from './model'

const mailOperations: ReadonlySet<Operation> = new Set([
  'sign-up',
  'magic-link',
  'reset-link',
  'reset-code',
  'send-code'
])

export function validation(
  model: Model,
  operation: Operation,
  includeChallenge = true
): string | undefined {
  if (operation === 'verify-current-password') {
    if (!model.fields.password) {
      return m.form_password()
    }
    if (model.flags.twoFactorEnabled) {
      return sixDigitCodeValidator({ value: model.fields.code })
    }
  }
  if (operation === 'password' || mailOperations.has(operation)) {
    const error = emailValidator({ value: model.fields.email })
    if (error) {
      return error
    }
  }
  if (operation === 'sign-up' && !model.fields.name.trim()) {
    return m.name_required()
  }
  if (
    ['password', 'sign-up', 'reset-password'].includes(operation) ||
    (operation === 'verify-code' && model.flags.page === 'forgot-password')
  ) {
    const error = passwordValidator({ value: model.fields.password })
    if (error) {
      return error
    }
  }
  if (
    (operation === 'reset-password' ||
      (operation === 'verify-code' && model.flags.page === 'forgot-password')) &&
    model.fields.password !== model.fields.confirm
  ) {
    return m.passwords_do_not_match()
  }
  if (operation === 'totp' || operation === 'verify-code') {
    return sixDigitCodeValidator({ value: model.fields.code })
  }
  if (operation === 'backup') {
    return backupCodeValidator({ value: model.fields.code })
  }
  if (
    includeChallenge &&
    mailOperations.has(operation) &&
    model.flags.turnstileSiteKey !== null &&
    model.token === null
  ) {
    return m.complete_bot_check()
  }
  return undefined
}

function request(model: Model, operation: Operation): Update.Return<Model, Message> {
  if (
    !model.ready ||
    model.pending ||
    (operation === 'passkey' && model.autofillPending)
  ) {
    return { model }
  }
  if ((operation === 'send-code' || operation === 'reset-code') && model.cooldown > 0) {
    return { model }
  }
  const error = validation(model, operation)
  if (error) {
    return { model: { ...model, error }, commands: [Focus({ id: 'auth-error' })] }
  }
  const next = {
    ...model,
    pending: true,
    autofillPending: false,
    error: null,
    notice: null,
    request: model.request + 1
  }
  return { model: next, commands: [Exchange({ model: next, operation })] }
}

export function init(flags: Flags): Update.Return<Model, Message> {
  return {
    model: initialModel(flags),
    commands: [Ready()]
  }
}

export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'AutofillPending': {
      return { model: { ...model, autofillPending: message.pending } }
    }
    case 'FocusedDigit': {
      return { model, commands: [SelectDigit({ index: message.index })] }
    }
    case 'ChangedDigit': {
      if (model.pending) {
        return { model }
      }
      const digits = message.value.replaceAll(/\D/g, '')
      const index = message.index
      const value = model.fields.code
      let code = value.slice(0, index) + digits + value.slice(index + 1)
      let focus = Math.min(index, value.length - 1)
      if (digits.length > 0) {
        focus = index + digits.length
      }
      if (digits.length > 1) {
        code = value.slice(0, index) + digits
      }
      return {
        model: { ...model, fields: { ...model.fields, code: code.slice(0, 6) } },
        commands: [Focus({ id: digitId(Math.max(0, Math.min(5, focus))) })]
      }
    }
    case 'PressedDigit': {
      if (model.pending) {
        return { model }
      }
      const value = model.fields.code
      let code = value
      let focus = message.index + (message.key === 'ArrowLeft' ? -1 : 1)
      if (message.key === 'Backspace') {
        const target = message.index < value.length ? message.index : value.length - 1
        if (target < 0) {
          return { model }
        }
        code = value.slice(0, target) + value.slice(target + 1)
        focus = message.index < value.length ? target - 1 : target
      }
      return {
        model: { ...model, fields: { ...model.fields, code } },
        commands: [Focus({ id: digitId(Math.max(0, Math.min(5, focus))) })]
      }
    }
    case 'Ready': {
      return {
        model: { ...model, ready: true, lastLoginMethod: message.lastLoginMethod }
      }
    }
    case 'SelectedLocale': {
      if (!model.ready || model.pending || message.locale === model.flags.locale) {
        return { model }
      }
      const next = { ...model, localeTarget: message.locale }
      if (Object.values(model.fields).some((value) => value.length > 0)) {
        return { model: next }
      }
      return update(next, { _tag: 'ConfirmedLocale' })
    }
    case 'CancelledLocale': {
      return {
        model: { ...model, localeTarget: null },
        commands: [Focus({ id: 'auth-locale' })]
      }
    }
    case 'ConfirmedLocale': {
      if (model.localeTarget === null || model.pending) {
        return { model }
      }
      const next = { ...model, request: model.request + 1, pending: true }
      return {
        model: next,
        commands: [
          ChangeLocale({
            locale: model.localeTarget,
            authenticated: model.flags.authenticated,
            request: next.request
          })
        ]
      }
    }
    case 'ChangedField': {
      return {
        model: { ...model, fields: { ...model.fields, [message.field]: message.value } }
      }
    }
    case 'ChangedTrust': {
      return { model: { ...model, trustDevice: message.value } }
    }
    case 'ChangedChallenge': {
      return { model: { ...model, token: message.token } }
    }
    case 'Submitted': {
      return request(model, submitOperation(model))
    }
    case 'Requested': {
      return request(model, message.operation)
    }
    case 'ChangedMode': {
      return model.pending
        ? { model }
        : {
            model: {
              ...model,
              mode: message.mode,
              stage: 'form',
              error: null,
              notice: null
            }
          }
    }
    case 'Failed': {
      return message.request === model.request
        ? {
            model: {
              ...model,
              pending: false,
              error: message.error,
              token: null,
              challengeRevision: model.challengeRevision + 1
            },
            commands: [Focus({ id: 'auth-error' })]
          }
        : { model }
    }
    case 'Sent': {
      return message.request === model.request
        ? {
            model: {
              ...model,
              pending: false,
              stage: message.stage,
              token: null,
              challengeRevision: model.challengeRevision + 1,
              cooldown: 60
            },
            commands: [Focus({ id: message.stage === 'code' ? 'code' : 'auth-notice' })]
          }
        : { model }
    }
    case 'EnrollmentRequired': {
      return message.request === model.request
        ? {
            model: {
              ...model,
              pending: false,
              fields: { ...model.fields, password: '' },
              notice: m.security_enroll_next()
            },
            commands: [Focus({ id: 'auth-notice' })]
          }
        : { model }
    }
    case 'Tick': {
      return { model: { ...model, cooldown: Math.max(0, model.cooldown - 1) } }
    }
    case 'DifferentEmail': {
      return model.pending
        ? { model }
        : {
            model: {
              ...model,
              stage: 'form',
              fields: { ...model.fields, code: '' },
              error: null
            }
          }
    }
    case 'DemoOpened': {
      return { model: { ...model, demoOpen: true } }
    }
    case 'DemoClosed': {
      return {
        model: { ...model, demoOpen: false },
        commands: [Focus({ id: 'demo-credentials-trigger' })]
      }
    }
    case 'DemoFilled': {
      const credentials = message.member ? DEMO_MEMBER_CREDENTIALS : DEMO_CREDENTIALS
      return {
        model: {
          ...model,
          fields: { ...model.fields, ...credentials },
          demoOpen: false,
          mode: 'password',
          stage: 'form',
          error: null
        },
        commands: [Focus({ id: 'password' })]
      }
    }
    case 'CompletedDom': {
      return { model }
    }
  }
}
