# Webhook investigation tasks

Saved delivery checks and exact replay proposals. `webhook-investigation-tasks.ts`
owns the contract and shared behavior; Seed and Live own storage only.

- Callers require `assistant:read` and `webhook:list`. Approval and cancellation
  additionally require `webhook:replay`, using the current member on every call.
- A proposal identifies one source delivery and its endpoint URL. Re-check both
  at approval; automatic retries and permanent receiver refusals produce findings
  without a replay proposal.
- Storage atomically claims a proposal as approved or cancelled with its audit.
  Approval retains a stable replay ID before enqueue, so an uncertain queue result
  can be reconciled without creating another delivery.
- Task outcome is projected from the replay delivery. A model response and a
  successful enqueue never establish delivery success. Missing retained evidence
  yields `unavailable`.
- Saved evidence contains bounded attempt identifiers, timestamps, statuses and
  response codes. Payloads, signing headers and response bodies are excluded.
- The task list returns the latest 30 tasks; direct lookup supports older task URLs.
  Live records survive requests; Seed state belongs to its provided Layer scope.
