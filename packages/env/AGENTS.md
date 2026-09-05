# @b2b-saas-starter/env

## Purpose & Scope

`ServerEnvSchema` (`src/server.ts`) lists the server env vars; everything else derives from it. No reader lives here: workers read `cloudflareEnv.X` directly, keeping an unset optional var inactive instead of a boot failure.

## Entry Points & Contracts

- Two subpaths, no root export. `./social` holds provider ids for browser code and must stay `effect`-free.
- The two alchemy forwarding lists are `satisfies ReadonlyArray<keyof ServerEnv>`, so a dropped var fails to compile. Secret keys get `Redacted`.
- `ProviderEnvOf<K>` keys are explicitly `| undefined`, because `exactOptionalPropertyTypes` makes a bare `?:` reject the `undefined` a worker env bag passes for an unset var.
- `activeSocialProviders` needs id and secret both set (ADR 0070); its return type names each provider, never `Partial<Record<…>>`.
- `auditRequiredEnv` reports, never throws. It rejects placeholders by value rather than absence (including the shipped `.env.example` secret), short secrets, localhost, example, or non-`https` production URLs, and unparsable trusted origins (which silently lose their CSRF carve-out). `apps/web`'s `enforceRequiredEnvOnce` throws on a production verdict and otherwise emits one `config.insecure` event. `requireEmailVerification` gates on production alone — the `prod` alchemy stage defaults `ENVIRONMENT` to `production` (preview forces `preview`; unset stays local).

## Usage Patterns

Adding a var: `ServerEnvSchema` first, then at most one key list if alchemy forwards it. Nothing else needs editing: `alchemy.run.ts`, worker env types and `ProviderEnvOf` slices all derive from the schema.

## Anti-patterns

- Never add a reader, a `Config` layer, or a decode-at-boot step; that makes an unset optional provider a boot failure.
- Never hand-roll a presence check (`!!x`, `x?.length`). `hasValue` alone treats `null` (workerd's present-but-null bindings) as unconfigured; whitespace counts as set.
- Never declare a var in a worker `.d.ts` or `alchemy.run.ts` before the schema; derivation is one-way.
- Never put a var in both key lists, or a secret in the plain list.
- Never import `./server` from browser-bound code.

## Dependencies & Edges

`effect` only. ADRs 0031, 0055, 0065, 0068, 0070.
