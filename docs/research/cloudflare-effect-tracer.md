# Effect native tracing assessment

Reviewed 2026-10-03. Keep the current Effect/OTLP implementation. Do not adopt
`cloudflare-effect-tracer` or build a general replacement now. A native adapter
is worth revisiting when an investigation needs application operations and
Cloudflare binding operations in the same waterfall.

## What it adds

The package targets Effect v4 and implements its tracer interface using native
Workers spans. It uses `startActiveSpan`, captures JavaScript async context, and
restores that context when Effect evaluates a primitive. It ends native spans
when Effect ends its spans. This addresses the mismatch between Effect fiber
execution and JavaScript async context more carefully than wrapping construction
of a lazy Effect in `enterSpan`.
[Implementation](https://github.com/third774/cloudflare-effect-tracer/blob/20b7612423d7bbe4c31e0889de11212704dddbec/src/index.ts)

The benefit is a Cloudflare trace view containing application operations and
automatic binding operations, without an application-side OTLP trace exporter.
That is useful for a Cloudflare-only deployment. It does not replace our log and
metric exporters. The package is MIT licensed and currently version 0.1.3 with
an Effect peer dependency of `^4.0.0`, matching our pinned major version.
[Package](https://github.com/third774/cloudflare-effect-tracer/blob/20b7612423d7bbe4c31e0889de11212704dddbec/package.json),
[license](https://github.com/third774/cloudflare-effect-tracer/blob/20b7612423d7bbe4c31e0889de11212704dddbec/LICENSE)

## Fit with this repository

We already have named capability spans, request scopes, HTTP and queue trace
continuation, RED metrics, and optional per-invocation OTLP export. Without a
collector, console events remain available but the optional exporter is inactive.
Native tracing is disabled by default in deployment configuration. See
[logger guidance](../../packages/logger/AGENTS.md),
[trace continuation](../../packages/logger/src/trace.ts),
[OTLP configuration](../../packages/logger/src/otlp.ts), and
[deployment configuration](../../alchemy.run.ts).

Adoption has three concrete obstacles:

- The adapter forwards scalar attributes and raw exception details to native
  spans. Our [output policy](../../packages/logger/README.md) excludes arbitrary
  attributes, exception messages, and stacks. Native writes bypass
  [our OTLP sanitizer](../../packages/logger/src/otlp-sanitization.ts). Filtering
  must happen at the native output boundary, including failure recording.
- The package and `Otlp.layer` both install `Tracer.Tracer`. Merging layers does
  not make spans export through both. Adoption needs an explicit exporter choice
  or a deliberately composed tracer. It must preserve logs and metrics as well.
- Effect trace IDs become native attributes rather than native IDs. An external
  Effect parent cannot establish a native parent. Existing HTTP and queue
  continuation therefore cannot be assumed to produce one native trace tree.

These conclusions follow from the
[adapter source](https://github.com/third774/cloudflare-effect-tracer/blob/20b7612423d7bbe4c31e0889de11212704dddbec/src/index.ts)
and the locally installed Effect 4.0.0 `Otlp` and `OtlpTracer` implementations.
Cloudflare still documents no manual parent wiring, no public trace/span ID
access, and no `setStatus`. A handcrafted adapter cannot remove those platform
constraints. [Custom span API](https://developers.cloudflare.com/workers/observability/traces/custom-spans/)

The implementation uses Effect runtime details such as `fiber.cache.span` and
`~effect/Effect/evaluate`. Its context strategy is plausible, but source review
does not prove correct nesting under deployed concurrent requests, fiber forks,
interruptions, or streaming. The repository is young, and its fake-context tests
do not establish native runtime behavior.
[Source and tests](https://github.com/third774/cloudflare-effect-tracer)

## Adoption or handcrafting later

Prefer an upstream integration if it gains configurable output filtering and
demonstrated compatibility with our export requirements. Owning a full tracer
means maintaining fiber context, span lifecycle, sampling, and failure behavior.
Avoid that maintenance without a concrete diagnostic benefit.

First trial automatic native tracing on a preview Worker after reviewing its
collection policy. It may answer the diagnostic question without a bridge.

If application spans are still needed, trial a narrow, optional adapter
inside `packages/logger`. Keep the existing Effect trace context authoritative,
reuse the diagnostic allowlist, and treat native IDs as separate until the
platform supports verified propagation. Effect's current `Otlp.layer` exposes a
`tracerContext` hook, but that alone supplies neither native span lifecycle nor
dual export. It is an investigation point, not a ready-made integration.

Before shipping, a deployed test must show correct duration and parentage across
an async suspension, parallel fibers, failure, interruption, and an HTTP-to-queue
handoff. Inspect exported attributes and exceptions for sensitive data, verify
sampling and disabled-provider behavior, and confirm OTLP logs and metrics still
arrive. Enable native tracing only after reviewing automatic platform records,
which also bypass the application sanitizer. The existing
[Cloudflare observability assessment](./cloudflare-observability.md) records that
separate collection decision.

## Local trial preparation

The follow-up trial is prepared through Alchemy's native `observability.traces`
configuration. `CLOUDFLARE_TRACING_TRIAL_STAGE` must exactly match the deployed
`pr-<number>` stage. All other stages explicitly disable tracing. The selected
preview enables persistent automatic spans at 100% sampling, without an Effect
adapter. [Deployment and rollback commands](../deploying.md#trial-automatic-tracing)
describe how to run the bounded trial.

On 2026-10-03, the existing Wrangler login could read Worker settings and
deployments, but telemetry key discovery returned HTTP 403 with authentication
error code 10000. No connected Observability tool was available. The user selected
local configuration preparation, so no Worker settings were changed and no
preview was deployed. There is no live trace window or captured trace evidence.
The deployed trial and output inspection remain outstanding.
