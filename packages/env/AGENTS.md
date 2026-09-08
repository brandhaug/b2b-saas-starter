# @b2b-saas-starter/env

`ServerEnv` (`src/server.ts`) lists the server env vars as a plain type; forwarding lists and worker types derive from it. No reader lives here: workers read `cloudflareEnv.X` directly, keeping an unset optional var inactive instead of a boot failure.

## Contracts

- The two alchemy forwarding lists are `satisfies ReadonlyArray<keyof ServerEnv>`, so a dropped var fails to compile. Secret keys get `Redacted`.
- `ProviderEnvOf<K>` keys are explicitly `| undefined`, because `exactOptionalPropertyTypes` makes a bare `?:` reject the `undefined` a worker env bag passes for an unset var.
- `auditRequiredEnv` reports, never throws. It rejects placeholders by value rather than absence (including the shipped `.env.example` secret), short secrets, localhost, example, or non-`https` production URLs, and unparsable trusted origins (which silently lose their CSRF carve-out). `apps/web`'s `enforceRequiredEnvOnce` throws on a production verdict and otherwise emits one `config.insecure` event. `requireEmailVerification` gates on production alone. The `prod` alchemy stage defaults `ENVIRONMENT` to `production` (preview forces `preview`; unset stays local).

## Changes

Adding a var: `ServerEnv` first, then at most one key list if alchemy forwards it. Nothing else needs editing: `alchemy.run.ts`, worker env types and `ProviderEnvOf` slices all derive from the type.

## Boundaries

- Never add a reader, a `Config` layer, or a decode-at-boot step; that makes an unset optional provider a boot failure.
- Never hand-roll a presence check (`!!x`, `x?.length`). `hasValue` alone treats `null` (workerd's present-but-null bindings) as unconfigured; whitespace counts as set.
- Never declare a var in a worker `.d.ts` or `alchemy.run.ts` before the schema; derivation is one-way.
- Never put a var in both key lists, or a secret in the plain list.
- Never import `./server` from browser-bound code.
