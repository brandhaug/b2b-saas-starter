import { Effect, Redacted } from 'effect'
import { type ContractExpect } from '../governance/contract-expect.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { WebhookDispatch } from './webhook-dispatch.ts'
import { WebhookEndpoints } from './webhook-endpoints.ts'

type WebhookDispatchContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    | Effect.Error<ReturnType<WebhookEndpoints['Service']['create']>>
    | Effect.Error<ReturnType<WebhookEndpoints['Service']['rotateSecret']>>
    | Effect.Error<ReturnType<WebhookEndpoints['Service']['sendTestEvent']>>
    | Effect.Error<ReturnType<WebhookDispatch['Service']['getDispatchTarget']>>,
    WebhookEndpoints | WebhookDispatch | WorkspaceContext
  >
}

/**
 * Signing secrets cross from capabilities into `apps/background` (dispatch)
 * and into the response encoders (create/rotate reveal), where spans, logs
 * and failure causes serialize whatever they hold. Run against
 * both adapters: Seed in `webhook-dispatch.test.ts`, Live in
 * `webhook-endpoints.live.test.ts`.
 */
export function webhookDispatchContractCases(
  expect: ContractExpect
): ReadonlyArray<WebhookDispatchContractCase> {
  return [
    {
      name: 'create, rotate and the dispatch target carry signing secrets redacted',
      assert: Effect.gen(function* () {
        const webhooks = yield* WebhookEndpoints
        const dispatch = yield* WebhookDispatch
        const ctx = yield* WorkspaceContext
        const created = yield* webhooks.create({
          url: 'https://example.com/redacted-hook',
          events: ['demo.event']
        })
        const rotated = yield* webhooks.rotateSecret({
          endpointId: created.endpoint.id
        })
        const sent = yield* webhooks.sendTestEvent({ endpointId: created.endpoint.id })
        const target = yield* dispatch.getDispatchTarget(
          created.endpoint.id,
          ctx.workspace.id,
          sent.deliveryId
        )
        if (target === null) {
          expect(target).toMatchObject({ id: created.endpoint.id })
          return
        }
        const createdSecret = Redacted.value(created.signingSecret)
        const rotatedSecret = Redacted.value(rotated.signingSecret)
        // oxlint-disable-next-line effect/noGlobals -- the assertion is what JSON serialization (logs, spans, causes) exposes
        const serialized = JSON.stringify({ created, rotated, target })
        for (const plaintext of [createdSecret, rotatedSecret]) {
          expect(serialized.includes(plaintext)).toBe(false)
        }
        // The plaintext still reaches the signer, current secret first.
        expect(target.signingSecrets.map((secret) => Redacted.value(secret))).toEqual([
          rotatedSecret,
          createdSecret
        ])
      })
    }
  ]
}
