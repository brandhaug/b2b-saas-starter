import { Schema } from 'effect'
import * as Checkout from '../account-admin/checkout'
import { Page } from '@/http/page-contract'
import {
  ConversationHistoryPage,
  ConversationSummaries
} from '@/http/contracts/conversation-records'
import { WebhookDeliveryAttempts } from '@/http/contracts/webhook-records'
import { WebhookInvestigationTask } from '@/http/contracts/assistant-records'

export const WorkspacePage = Schema.Union([
  Page.cases.dashboard,
  Page.cases.members,
  Page.cases.settings,
  Page.cases.billing,
  Page.cases['api-tokens'],
  Page.cases.webhooks,
  Page.cases.audit,
  Page.cases.assistant,
  Page.cases.suspended
])
export type WorkspacePage = typeof WorkspacePage.Type
export const Flags = Schema.Struct({
  page: WorkspacePage,
  slug: Schema.String,
  actorUserId: Schema.String,
  preview: Schema.Boolean,
  url: Schema.String
})
export type Flags = typeof Flags.Type
export const Role = Schema.Literals(['owner', 'admin', 'member'])
export const Scope = Schema.Literals(['read', 'write', 'admin'])
export const InviteResult = Schema.Struct({
  email: Schema.String,
  ok: Schema.Boolean,
  message: Schema.String
})
export const Members = Schema.Struct({
  emails: Schema.String,
  role: Role,
  batchRole: Role,
  results: Schema.Array(InviteResult)
})
export const Settings = Schema.Struct({
  name: Schema.String,
  confirmation: Schema.String,
  protocol: Schema.Literals(['oidc', 'saml']),
  domain: Schema.String,
  issuer: Schema.String,
  clientId: Schema.String,
  clientSecret: Schema.String,
  metadataUrl: Schema.String,
  metadataXml: Schema.String,
  role: Schema.Literals(['member', 'admin'])
})
export const Tokens = Schema.Struct({
  name: Schema.String,
  scopes: Schema.Array(Scope),
  expiry: Schema.String,
  overlap: Schema.String,
  replacement: Schema.NullOr(Schema.String)
})
export const Webhooks = Schema.Struct({
  url: Schema.String,
  events: Schema.Array(Schema.String),
  editing: Schema.NullOr(Schema.String),
  delivery: Schema.NullOr(Schema.String),
  attempts: WebhookDeliveryAttempts,
  wrap: Schema.Boolean
})
export const Billing = Schema.Struct({
  interval: Schema.Literals(['month', 'year']),
  tokenIds: Schema.Array(Schema.String),
  endpointIds: Schema.Array(Schema.String)
})
export const Assistant = Schema.Struct({
  conversations: ConversationSummaries,
  nextCursor: Schema.NullOr(Schema.String),
  conversationId: Schema.NullOr(Schema.String),
  history: Schema.NullOr(ConversationHistoryPage),
  connection: Schema.Literals(['connecting', 'connected', 'reconnecting', 'denied']),
  generation: Schema.Number,
  question: Schema.String,
  intentText: Schema.String,
  intentTask: Schema.String,
  intentKey: Schema.String,
  retryAttempt: Schema.String,
  retryKey: Schema.String,
  deliveryId: Schema.String,
  investigation: Schema.String,
  selectedTask: Schema.NullOr(WebhookInvestigationTask)
})
export const Action = Schema.TaggedUnion({
  Refresh: {},
  DismissChecklist: {},
  MarkRead: { ids: Schema.Array(Schema.String) },
  Invite: { retry: Schema.Boolean },
  Role: { userId: Schema.String, role: Role },
  RemoveMember: { userId: Schema.String },
  Leave: {},
  CancelInvitation: { id: Schema.String },
  ResendInvitation: { id: Schema.String },
  Rename: {},
  DeleteWorkspace: {},
  CreateSso: {},
  UpdateSso: {
    id: Schema.String,
    enabled: Schema.optionalKey(Schema.Boolean),
    requireSso: Schema.optionalKey(Schema.Boolean),
    role: Schema.optionalKey(Schema.Literals(['member', 'admin'])),
    rotate: Schema.optionalKey(Schema.Boolean)
  },
  TestSso: { id: Schema.String },
  RemoveSso: { id: Schema.String },
  Export: {},
  DownloadExport: { id: Schema.String },
  CreateToken: {},
  ReplaceToken: { id: Schema.String },
  RevokeToken: { id: Schema.String },
  CreateWebhook: {},
  SaveWebhook: { id: Schema.String },
  ToggleWebhook: { id: Schema.String, enabled: Schema.Boolean },
  RotateWebhook: { id: Schema.String },
  TestWebhook: { id: Schema.String },
  ReplayWebhook: { id: Schema.String },
  Attempts: { id: Schema.String },
  Checkout: { planId: Schema.String },
  Portal: {},
  Reconcile: {},
  SelectResources: {},
  ListConversations: { cursor: Schema.NullOr(Schema.String) },
  CreateConversation: {},
  History: { cursor: Schema.NullOr(Schema.String) },
  Send: {},
  RetryAnswer: { id: Schema.String },
  StopAnswer: { id: Schema.String },
  DeleteConversation: {},
  Investigate: {},
  ReadTask: { id: Schema.String },
  ApproveTask: { id: Schema.String },
  CancelTask: { id: Schema.String }
})
export type Action = typeof Action.Type
export const Model = Schema.Struct({
  flags: Flags,
  page: WorkspacePage,
  url: Schema.String,
  ready: Schema.Boolean,
  pending: Schema.Boolean,
  pendingAction: Schema.NullOr(Action),
  request: Schema.Number,
  error: Schema.NullOr(Schema.String),
  failedAction: Schema.NullOr(Action),
  notice: Schema.NullOr(Schema.String),
  dialog: Schema.NullOr(Schema.String),
  dialogClosing: Schema.Boolean,
  historyOpened: Schema.Boolean,
  confirmation: Schema.NullOr(Action),
  secret: Schema.NullOr(Schema.String),
  secretVisible: Schema.Boolean,
  members: Members,
  settings: Settings,
  tokens: Tokens,
  webhooks: Webhooks,
  billing: Billing,
  checkout: Schema.NullOr(Checkout.Model),
  tableSearch: Schema.Record(Schema.String, Schema.String),
  tableOperators: Schema.Record(Schema.String, Schema.String),
  tablePopover: Schema.NullOr(Schema.String),
  assistant: Assistant
})
export type Model = typeof Model.Type
export const Result = Schema.TaggedUnion({
  Done: { notice: Schema.String },
  Page: { page: WorkspacePage },
  Secret: { secret: Schema.String, notice: Schema.String },
  Invitations: { results: Schema.Array(InviteResult) },
  Attempts: { attempts: WebhookDeliveryAttempts },
  Conversations: {
    items: ConversationSummaries,
    nextCursor: Schema.NullOr(Schema.String),
    append: Schema.Boolean
  },
  CreatedConversation: { id: Schema.String },
  DeletedConversation: {},
  History: {
    history: ConversationHistoryPage,
    cursor: Schema.NullOr(Schema.String),
    conversationId: Schema.String
  },
  Task: { task: WebhookInvestigationTask },
  AccessLost: { message: Schema.String }
})
export type Result = typeof Result.Type
export const Message = Schema.TaggedUnion({
  Checkout: { message: Checkout.Message },
  Ready: {},
  Noop: {},
  Perform: { action: Action },
  Prepared: { request: Schema.Number, now: Schema.Number, key: Schema.String },
  Copied: { notice: Schema.String },
  Confirm: { action: Action, title: Schema.String },
  Confirmed: {},
  Close: {},
  DialogClosed: {},
  Open: { dialog: Schema.String },
  TableSearch: { key: Schema.String, value: Schema.String },
  ClearList: { key: Schema.String, tableViews: Schema.String },
  TableOpen: { id: Schema.String, operator: Schema.String },
  TablePopover: { id: Schema.String, open: Schema.Boolean },
  Query: {
    key: Schema.String,
    value: Schema.String,
    replace: Schema.Boolean,
    dismiss: Schema.optionalKey(Schema.String),
    draftOperator: Schema.optionalKey(
      Schema.Struct({ id: Schema.String, operator: Schema.String })
    )
  },
  Location: { url: Schema.String },
  Completed: { request: Schema.Number, result: Result },
  Failed: { request: Schema.Number, error: Schema.String },
  Copy: { text: Schema.String, secret: Schema.optionalKey(Schema.Boolean) },
  ToggleSecret: {},
  MemberField: { field: Schema.Literals(['emails', 'role']), value: Schema.String },
  SettingField: {
    field: Schema.Literals([
      'name',
      'confirmation',
      'protocol',
      'domain',
      'issuer',
      'clientId',
      'clientSecret',
      'metadataUrl',
      'metadataXml',
      'role'
    ]),
    value: Schema.String
  },
  TokenField: {
    field: Schema.Literals(['name', 'expiry', 'overlap']),
    value: Schema.String
  },
  TokenScope: { scope: Scope },
  Replace: { id: Schema.String },
  WebhookField: { value: Schema.String },
  WebhookEvent: { event: Schema.String },
  EditWebhook: { id: Schema.String },
  Wrap: {},
  HideAttempts: {},
  Interval: { value: Schema.Literals(['month', 'year']) },
  Resource: { kind: Schema.Literals(['token', 'endpoint']), id: Schema.String },
  AssistantField: {
    field: Schema.Literals(['question', 'deliveryId', 'investigation']),
    value: Schema.String
  },
  SelectConversation: { id: Schema.String },
  SelectTask: { id: Schema.String },
  Reconnect: {},
  Snapshot: {
    conversationId: Schema.String,
    generation: Schema.Number,
    history: ConversationHistoryPage
  },
  Connection: {
    conversationId: Schema.String,
    generation: Schema.Number,
    state: Schema.Literals(['connecting', 'connected', 'reconnecting', 'denied'])
  }
})
export type Message = typeof Message.Type
