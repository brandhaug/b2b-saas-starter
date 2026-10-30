import { Schema } from 'effect'
import { InvitationRecord, OptionalInvitations } from './dashboard-records'
import { ChangeUserWorkspaceRoleSchema } from './administration-records'
import { EmailDeliveryPurpose, EmailDeliveryStatus } from './email-records'

export const InvitationPreviewSchema = Schema.Struct({
  state: Schema.Literal('pending'),
  invitationId: Schema.String,
  workspaceName: Schema.String,
  workspaceSlug: Schema.String,
  role: Schema.Union([
    Schema.Literal('owner'),
    Schema.Literal('admin'),
    Schema.Literal('member')
  ])
})

export const InvitationPreviewResult = Schema.Union([
  InvitationPreviewSchema,
  Schema.Struct({ state: Schema.Literal('unavailable') })
])

export const ResendInvitationSchema = Schema.Struct({
  invitation: InvitationRecord,
  status: Schema.Union([
    Schema.Literal('accepted'),
    Schema.Literal('failed'),
    Schema.Literal('logged'),
    Schema.Literal('skipped')
  ]),
  inviteUrl: Schema.String
})

export const WorkspaceMembers = Schema.Array(ChangeUserWorkspaceRoleSchema)

export const InvitationEmailDelivery = Schema.Struct({
  id: Schema.String,
  referenceId: Schema.Union([Schema.Null, Schema.String]),
  purpose: EmailDeliveryPurpose,
  recipient: Schema.String,
  userId: Schema.Union([Schema.Null, Schema.String]),
  workspaceId: Schema.Union([Schema.Null, Schema.String]),
  status: EmailDeliveryStatus,
  providerMessageId: Schema.Union([Schema.Null, Schema.String]),
  lastEventId: Schema.Union([Schema.Null, Schema.String]),
  lastEventAt: Schema.Union([Schema.Null, Schema.String]),
  reason: Schema.Union([Schema.Null, Schema.String]),
  acceptedAt: Schema.Union([Schema.Null, Schema.String]),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  retryUntil: Schema.String,
  nextAttemptAt: Schema.String,
  attemptCount: Schema.Number,
  uncertain: Schema.Boolean,
  unconfirmed: Schema.Boolean,
  resendAllowed: Schema.Boolean
})

export const InvitationEmailDeliveries = Schema.Array(InvitationEmailDelivery)

export const OptionalInvitationEmailDeliveries = Schema.Union([
  Schema.Null,
  InvitationEmailDeliveries
])

export const SeatUsageSchema = Schema.Struct({
  pricing: Schema.Union([Schema.Literal('flat'), Schema.Literal('per_seat')]),
  included: Schema.Union([Schema.Null, Schema.Number]),
  used: Schema.Number,
  overLimit: Schema.Boolean
})

export const LoadWorkspaceMembersSchema = Schema.Struct({
  viewer: Schema.Union([
    Schema.Null,
    Schema.Struct({
      role: Schema.Union([
        Schema.Literal('owner'),
        Schema.Literal('admin'),
        Schema.Literal('member')
      ])
    })
  ]),
  unreadCount: Schema.Number,
  members: WorkspaceMembers,
  invitations: OptionalInvitations,
  emailDeliveries: OptionalInvitationEmailDeliveries,
  seatUsage: SeatUsageSchema
})
