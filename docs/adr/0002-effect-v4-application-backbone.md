# Effect v4 application backbone

Effect v4 owns application services, schemas, typed errors, and HTTP contracts. A shared error and dependency model lets web, API, and background entry points compose the same behavior without a parallel result library. React rendering and client data access follow [ADR 0040](./0040-loaders-and-server-functions-for-server-state.md).

Effect Schema also owns browser decoding and validation. Route inputs, stored preferences and serialized errors use compiled schemas with explicit fallback behavior. Shared resource identity schemas work in browser fixtures and server contracts. The client bundle guard rejects server execution modules, not Effect or Schema. Database access, credentials and capability execution remain behind server functions; browser validation never replaces server authorization or validation.
