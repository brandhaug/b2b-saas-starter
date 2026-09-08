# Wide event observability

Each request or background invocation emits one structured event combining its outcome and relevant context. This makes a failed workflow inspectable without reconstructing it from unrelated log lines. Trace propagation, optional exports, and request scoping follow [ADR 0050](./0050-opentelemetry-export-scoped-per-invocation.md).
