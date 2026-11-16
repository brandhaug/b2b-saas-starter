# @b2b-saas-starter/rate-limit

One rate limiter over Cloudflare's ratelimit bindings, with an in-memory fallback so local dev and tests run without them. Buckets, budgets and binding names are owned by [`infra/bindings.ts`](../../infra/bindings.ts); this package takes them as config.

## Contracts

- `makeRateLimiter({ binding, fallbackLimits })` is generic in the bucket union, so a worker's buckets come from `infra/bindings.ts` and a new bucket fails the worker's build until it is wired.
- `take` never fails: a missing or erroring binding degrades to the fallback and annotates the request's wide event (`rateLimitDegraded`, `rateLimitFallback`, `rateLimitBucket`, plus `rateLimitCapacityRefused` when a full fallback bucket refuses a key), so fallback traffic is queryable. Those keys are allowlisted in [logger](../logger/AGENTS.md) sanitization; `rateLimitBindingError` carries provider text and is dropped there.
- `clientKey` trusts only `cf-connecting-ip`. `x-forwarded-for` is attacker-controlled — rotate the header, dodge the limit — so it is deliberately unused.

## Boundaries

- Don't treat the fallback as enforcement. Its state is per-isolate and lost on recycle, so the effective limit under real traffic is `limit × isolates`. Production limiting is the Cloudflare bindings; the fallback is a brake.
- Don't fail open on a binding error, and don't fail the request either: degrade and record.
- Don't depend on `@cloudflare/workers-types` here; `CloudflareRateLimit` is the binding subset this package needs.

## Pitfalls

- Limiting runs _before_ token verification (which costs a D1 read), so an unauthenticated flood cannot exhaust the database — which is why the key is an IP and not a token id.
- The fallback keeps one store per bucket, capped at 5000 keys. A full bucket refuses keys it does not track and records `rateLimitCapacityRefused`: evicting a tracked caller would reset that caller's allowance, so under a flood of distinct IPs a legitimate new caller is refused until the window frees room. The trade favours not reopening a tracked flood over admitting newcomers. Each take sweeps expired entries from the front of the store's insertion order and stops at the first live one, so the cost does not grow with the number of tracked keys.
