import { Schema } from 'effect'

export const AskAssistantSchema = Schema.Struct({
  ok: Schema.Literal(true),
  answer: Schema.String,
  provider: Schema.Union([
    Schema.Literal('workers-ai'),
    Schema.Literal('openai-compatible'),
    Schema.Literal('mock')
  ]),
  modelId: Schema.String
})

export const AssistantAnswerResult = Schema.Union([
  AskAssistantSchema,
  Schema.Struct({
    ok: Schema.Literal(false),
    reason: Schema.Union([
      Schema.Literal('unavailable'),
      Schema.Literal('unconfigured')
    ]),
    message: Schema.String
  })
])

export const WebhookInvestigationDiagnosis = Schema.Union([
  Schema.Literal('unknown'),
  Schema.Literal('delivered'),
  Schema.Literal('retrying'),
  Schema.Literal('receiver_unavailable'),
  Schema.Literal('receiver_rejected'),
  Schema.Literal('endpoint_disabled')
])

export const WebhookInvestigationEvidence = Schema.Struct({
  endpointId: Schema.String,
  endpointUrl: Schema.String,
  eventType: Schema.String,
  deliveryStatus: Schema.String,
  lastResponseStatus: Schema.Union([Schema.Null, Schema.Number]),
  attempts: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      attemptedAt: Schema.String,
      responseStatus: Schema.Union([Schema.Null, Schema.Number]),
      status: Schema.String
    })
  )
})

export const WebhookInvestigationTask = Schema.Struct({
  id: Schema.String,
  sourceDeliveryId: Schema.String,
  requestedBy: Schema.Union([Schema.Null, Schema.String]),
  question: Schema.String,
  status: Schema.Union([
    Schema.Literal('proposed'),
    Schema.Literal('approved'),
    Schema.Literal('cancelled'),
    Schema.Literal('completed')
  ]),
  diagnosis: WebhookInvestigationDiagnosis,
  evidence: WebhookInvestigationEvidence,
  replayDeliveryId: Schema.Union([Schema.Null, Schema.String]),
  outcome: Schema.Union([
    Schema.Null,
    Schema.Literal('unavailable'),
    Schema.Literal('pending'),
    Schema.Literal('delivered'),
    Schema.Literal('failed')
  ]),
  createdAt: Schema.String,
  updatedAt: Schema.String
})

export const WebhookInvestigationTasks = Schema.Array(WebhookInvestigationTask)

export const InvestigationsSchema = Schema.Struct({
  tasks: WebhookInvestigationTasks,
  deliveries: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      endpointId: Schema.String,
      endpointUrl: Schema.String,
      eventType: Schema.String,
      status: Schema.String
    })
  )
})

export const OptionalInvestigations = Schema.Union([Schema.Null, InvestigationsSchema])

export const OmittedInvestigations = Schema.optionalKey(OptionalInvestigations)

export const LoadAssistantPageSchema = Schema.Struct({
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
  configured: Schema.Boolean,
  investigations: OmittedInvestigations
})
