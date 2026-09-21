import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SeedAssistantAuthority } from './assistant-authority.ts'
import {
  assistantAuthorityContractCases,
  authorityResource
} from './assistant-authority.contract.ts'

describe('seed assistant authority', () => {
  for (const scenario of assistantAuthorityContractCases(expect)) {
    it.effect(scenario.name, () =>
      scenario.assert.pipe(
        Effect.provide(
          SeedAssistantAuthority(authorityResource, () =>
            Effect.succeed(scenario.state)
          )
        )
      )
    )
  }
})
