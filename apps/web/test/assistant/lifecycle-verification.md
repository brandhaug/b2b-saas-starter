# Conversation lifecycle verification

## Failure cases selected before implementation

- A scheduled authority check survives after the attempt settles and all observers
  leave, causing recurring idle wakeups. The real SDK alarm must cancel that schedule.
- Running an alarm early is mistaken for running its callback. Assert the callback
  is due, inspect the schedule before and after, and check the next alarm.
- Eviction is attempted while inference, SDK persistence, or a protected I/O task
  is pending. Complete inference and drain work first; keep production compatibility
  flags and report namespace-level refusal rather than disabling protection.
- A reconstructed instance loses saved answer text, changes a terminal attempt,
  forgets idempotency, duplicates inference, or reserves quota again. Compare the
  full history and reservation evidence after eviction and repeated delivery.
- A helper silently leaves the same instance alive. Compare an instance-identity
  probe across eviction, without adding a production testing API.

The existing native process-restart tests remain responsible for recovery from
terminated workerd with persisted D1 and SQLite. Graceful eviction cannot establish
that failure mode. Explicit conversation deletion is handled by the background
worker and `/cleanup`; the host's recurring alarm is authority revalidation.

## Reproduction

From the repository root, after `vp install`:

```sh
pnpm -C packages/i18n generate
pnpm -C apps/web run test:lifecycle
pnpm -C apps/web exec vp test run src/lib/assistant/conversation-host.live.test.ts
E2E_PORT=3497 pnpm run validate
```

`web`'s normal `test` command includes the dedicated lifecycle project. Its main
worker re-exports the production class directly. It uses migrated D1, SQLite
Durable Object storage, and a local SSE provider response with a request counter.
No live inference credentials are needed.

## Runtime preconditions and limits

The host calls `scheduleEvery(15, 'revalidateAuthority')` during admission. After
completion, with no socket observers, that callback cancels its own schedule.
`runDurableObjectAlarm` removes and invokes the alarm immediately, but the SDK
job driver still checks whether its scheduled job is due. The test scopes a
`Date.now` spy to the stored schedule time for this invocation and restores it
afterward. It does not replace timers or invoke `revalidateAuthority` directly.

Eviction requires a running instance in a namespace that permits eviction.
The project uses the production compatibility date and flags from
`infra/bindings.ts`, including `durable_object_io_tasks_prevent_eviction`, and
does not override namespace eviction protection. The fixture completes inference,
consumes response bodies, verifies released quota and no observers or remaining
alarm, then calls `evictDurableObject` to drain remaining I/O before teardown.

The host's `AbortSignal.timeout` timer survives completed inference. With the
default 600,000 ms deadline, the eviction probe exceeded the 30-second test
timeout. The fixture configures a 5,000 ms inference deadline so that timer can
expire naturally within the test budget. Production settings remain unchanged.
This tests completed, idle reconstruction only; it does not claim eviction can
interrupt a protected active run or reproduce deployed idle-eviction timing.

`runInDurableObject` only reads schedules, the alarm and connection count, and
assigns a test-side WeakMap identity to each instance. A changed identity proves
the post-eviction history comes from reconstruction. Full history equality,
joined repeated delivery, unchanged reservation rows and one provider request
check persistence and idempotency together.

## Observed results

Verified on 2026-10-09 with Vite+ 1.0.0, Vitest 5.0.1 and
`@cloudflare/vitest-plugin` 1.4.0, after rebasing onto master `8d3b8f88`.
`E2E_PORT=3497 pnpm run validate` exited successfully on the accompanying changes:

- Lifecycle tests: 2 passed, including a changed instance identity after eviction.
  The suite took 5.2 seconds with the 5-second fixture deadline.
- Native conversation host tests: 27 passed, including both process-restart cases.
- Web tests: 889 passed, plus the separate lifecycle project above.
- Background tests: 134 passed. Browser E2E: 62 passed.
- Script tests: 59 passed, 11 skipped by their existing configuration.
- Typecheck, lint, formatting, dead-code, unused-message checks, builds, generated
  Wrangler drift check, migration and seed completed successfully.

An earlier integrated attempt hit the existing authentication replay test's
5-second timeout. Its isolated rerun passed, and both subsequent full validation
runs passed without changing that test or its timeout.

Independent Standards and Spec reviews of the complete change reported no
actionable findings. Local evidence establishes the controlled runtime scenarios
above; CI status belongs to the pull request.
