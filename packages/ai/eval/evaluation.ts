// oxlint-disable effect/noGlobals, effect/noThrowStatement, effect/noNewError -- pure CLI evidence validation uses stable JSON and synchronous validation failures, never application recovery
import { Effect, Schema } from 'effect'
import { assistantInstructions } from '../src/assistant-instructions.ts'
import { AssistantService } from '../src/index.ts'
import { cases } from './cases.ts'

const Identity = Schema.Struct({
  provider: Schema.Literal('openai-compatible'),
  endpoint: Schema.Literal('https://api.openai.com/v1'),
  modelId: Schema.String.check(Schema.isMinLength(1)),
  maxOutputTokens: Schema.Number,
  sampling: Schema.Literal('provider-default; no temperature or seed sent'),
  samplesPerCase: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 2, maximum: 100 })
  ),
  instructions: Schema.String,
  cases: Schema.String,
  adapterDigest: Schema.String
})
type Identity = typeof Identity.Type

const Sample = Schema.Struct({
  caseId: Schema.String,
  repetition: Schema.Number,
  status: Schema.Literals(['ok', 'error']),
  output: Schema.String
})
const Run = Schema.Struct({
  version: Schema.Literal(1),
  identity: Identity,
  samples: Schema.Array(Sample),
  cost: Schema.Literal(
    'unknown: production stateless adapter does not expose usage or billing'
  ),
  review: Schema.Literal('pending human rubric review; no automatic quality verdict')
})
type Run = typeof Run.Type
const decodeIdentity = Schema.decodeUnknownSync(Identity)
const decodeRun = Schema.decodeUnknownSync(Schema.fromJsonString(Run))

export function createIdentity(
  modelId: string,
  samplesPerCase: number,
  adapterDigest = 'offline-test'
): Identity {
  return decodeIdentity({
    provider: 'openai-compatible',
    endpoint: 'https://api.openai.com/v1',
    modelId,
    maxOutputTokens: 4096,
    sampling: 'provider-default; no temperature or seed sent',
    samplesPerCase,
    instructions: assistantInstructions('evaluation-lab'),
    cases: JSON.stringify(cases),
    adapterDigest
  })
}

export const evaluate = Effect.fn('AssistantEvaluation.evaluate')(function* (
  identity: Identity
) {
  const assistant = yield* AssistantService
  const samples: Array<typeof Sample.Type> = []
  for (const item of cases) {
    for (let repetition = 0; repetition < identity.samplesPerCase; repetition++) {
      const sample = yield* assistant
        .ask({
          workspaceSlug: 'evaluation-lab',
          question: item.question,
          evidence: item.evidence
        })
        .pipe(
          Effect.match({
            onFailure: () => ({
              caseId: item.id,
              repetition,
              status: 'error' as const,
              output: 'AssistantUnavailable'
            }),
            onSuccess: (reply) => ({
              caseId: item.id,
              repetition,
              status: 'ok' as const,
              output: reply.answer
            })
          })
        )
      samples.push(sample)
    }
  }
  return {
    version: 1,
    identity,
    samples,
    cost: 'unknown: production stateless adapter does not expose usage or billing',
    review: 'pending human rubric review; no automatic quality verdict'
  } satisfies Run
})

export function serializeRun(run: Run): string {
  return `${JSON.stringify(run, null, 2)}\n`
}

export function decodeBaseline(text: string, identity: Identity): Run {
  const baseline = decodeRun(text)
  // Instructions are the intended comparison variable. Every other input must
  // match, including exact cases/rubrics, model, repetition count and settings.
  const before = { ...baseline.identity, instructions: '' }
  const after = { ...identity, instructions: '' }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('Baseline model, settings or cases differ')
  }
  const expected = cases.flatMap((item) =>
    Array.from(
      { length: identity.samplesPerCase },
      (_, repetition) => `${item.id}:${repetition}`
    )
  )
  if (
    baseline.samples.length !== expected.length ||
    baseline.samples.some(
      (sample, index) =>
        sample.status !== 'ok' ||
        sample.output.length === 0 ||
        `${sample.caseId}:${sample.repetition}` !== expected[index]
    )
  ) {
    throw new Error(
      'Baseline must contain every successful repeated sample exactly once'
    )
  }
  return baseline
}
