/// <reference types="node" />
// oxlint-disable effect/noNodeBuiltinImport, effect/noGlobals, effect/noThrowStatement, effect/noNewError, effect/noAsyncFunction -- this opt-in Node CLI owns files, credentials, process exit and the single Effect execution boundary
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { Effect, Layer } from 'effect'
import { AssistantLive } from '../src/index.ts'
import { makeOpenAIModel } from '../src/openai.ts'
import { cases } from './cases.ts'
import { createIdentity, decodeBaseline, evaluate, serializeRun } from './evaluation.ts'

const { values } = parseArgs({
  options: {
    paid: { type: 'boolean' },
    'establish-baseline': { type: 'boolean' },
    baseline: { type: 'string' },
    model: { type: 'string' },
    samples: { type: 'string', default: '3' },
    out: { type: 'string' }
  }
})

if (!values.paid || process.env.CI || !process.env.OPENAI_API_KEY) {
  throw new Error(
    'Unverified paid evaluation: requires --paid, OPENAI_API_KEY and a non-CI invocation.'
  )
}
if (
  !values.model ||
  !values.out ||
  Boolean(values.baseline) === Boolean(values['establish-baseline'])
) {
  throw new Error(
    'Supply --model, --out and exactly one of --baseline PATH or --establish-baseline.'
  )
}

// Keep production transport and decoding changes out of an instruction-only
// comparison. Record exact source bytes, including the dependency lockfile.
const adapterDigest = createHash('sha256')
for (const file of [
  '../src/index.ts',
  '../src/openai.ts',
  '../src/text-model.ts',
  '../src/provider-stream.ts',
  '../../../pnpm-lock.yaml'
]) {
  adapterDigest.update(readFileSync(new URL(file, import.meta.url)))
}
const identity = createIdentity(
  values.model,
  Number(values.samples),
  adapterDigest.digest('hex')
)
let baselineText: string | undefined
if (values.baseline) {
  baselineText = readFileSync(values.baseline, 'utf8')
}
if (baselineText !== undefined) {
  decodeBaseline(baselineText, identity)
}

// Reserve the evidence path before any billable request; never overwrite a run.
writeFileSync(
  values.out,
  JSON.stringify(
    {
      status: 'started; incomplete until replaced',
      identity,
      // oxlint-disable-next-line react-doctor/no-impure-call-at-module-scope -- a CLI module executes once per evaluation, not in a shared SSR process
      startedAt: new Date().toISOString()
    },
    null,
    2
  ),
  { flag: 'wx' }
)
if (baselineText !== undefined) {
  writeFileSync(`${values.out}.baseline.json`, baselineText, { flag: 'wx' })
}
writeFileSync(
  `${values.out}.review.md`,
  [
    '# Assistant instruction evaluation review',
    '',
    `Model: ${identity.modelId}. Samples per case: ${identity.samplesPerCase}.`,
    'Status: pending human review. No deterministic model-quality claim.',
    'Cost: unknown. Record actual billed cost from the provider account here.',
    'Compare each output with the saved baseline and rubric. Record pass/fail and explanation per repetition, then regressions and control changes.',
    '',
    ...cases.flatMap((item) => [
      `## ${item.id}`,
      '',
      `Source: ${item.source}`,
      '',
      item.rubric,
      '',
      'Verdicts: pending.',
      ''
    ])
  ].join('\n'),
  { flag: 'wx' }
)

const run = await Effect.runPromise(
  evaluate(identity).pipe(
    Effect.provide(
      AssistantLive.pipe(
        Layer.provide(
          makeOpenAIModel({
            apiKey: process.env.OPENAI_API_KEY,
            baseUrl: identity.endpoint,
            modelId: identity.modelId,
            maxOutputTokens: identity.maxOutputTokens
          })
        )
      )
    )
  )
)
writeFileSync(values.out, serializeRun(run))
if (run.samples.some((sample) => sample.status === 'error')) {
  process.exitCode = 1
}
