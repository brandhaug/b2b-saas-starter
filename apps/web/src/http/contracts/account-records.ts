import { Schema } from 'effect'
import { KindSchema } from './notification-records'

export const SetNotificationPreferenceSchema = Schema.Struct({
  kind: KindSchema,
  channel: Schema.Union([
    Schema.Literal('off'),
    Schema.Literal('instant'),
    Schema.Literal('digest')
  ]),
  isDefault: Schema.Boolean,
  label: Schema.String,
  description: Schema.String,
  security: Schema.Boolean
})

export const PreferencesSchema = Schema.Array(SetNotificationPreferenceSchema)

export const LoadNotificationPreferencesSchema = Schema.Struct({
  preferences: PreferencesSchema
})

export const AccountDeletionAction = Schema.Union([
  Schema.Literal('blocked_sole_owner'),
  Schema.Literal('blocked_suspended_workspace'),
  Schema.Literal('blocked_billing_workspace'),
  Schema.Literal('leave'),
  Schema.Literal('delete_workspace')
])

export const AccountDeletionStep = Schema.Struct({
  workspace: Schema.Struct({
    id: Schema.String,
    slug: Schema.String,
    name: Schema.String,
    planId: Schema.String
  }),
  role: Schema.Union([
    Schema.Literal('owner'),
    Schema.Literal('admin'),
    Schema.Literal('member')
  ]),
  action: AccountDeletionAction
})

export const AccountDeletionSteps = Schema.Array(AccountDeletionStep)

export const DeleteAccountSchema = Schema.Struct({
  steps: AccountDeletionSteps,
  canDelete: Schema.Boolean
})

export const LoadAccountPageSchema = Schema.Struct({
  deletionPlan: DeleteAccountSchema,
  preferences: PreferencesSchema
})
