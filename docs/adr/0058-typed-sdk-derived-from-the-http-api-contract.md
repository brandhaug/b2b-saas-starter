# Typed SDK from the HTTP API contract

The SDK derives its client from `StarterApi` through Effect `HttpApiClient`. Effect-native and promise-returning entry points share its schema and error decoding, so OpenAPI generation is unnecessary for the repository's own client. An injected fetch supports worker-handler integration tests.

The trade-off is a workspace dependency on the API and capability schemas. External publication would require separating those schemas; generating another contract copy now would add drift without solving that boundary.
