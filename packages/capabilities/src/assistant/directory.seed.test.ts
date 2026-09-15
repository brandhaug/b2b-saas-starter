import { assistantLifecycleContractCases } from './lifecycle.contract.ts'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { assistantDirectoryContractCases } from './directory.contract.ts'
import { SeedAssistantDirectory } from './directory.seed.ts'
import { SeedAssistantAdmission } from './admission.seed.ts'

const storage = Layer.merge(
  SeedAssistantDirectory,
  SeedAssistantAdmission.pipe(Layer.provide(SeedAssistantDirectory))
)
describe('Seed assistant directory and admission contract', () => {
  for (const testCase of [
    ...assistantDirectoryContractCases(expect),
    ...assistantLifecycleContractCases(expect)
  ]) {
    it.effect(testCase.name, () => testCase.assert.pipe(Effect.provide(storage)))
  }
})
