# Effect Atom for server state

The starter uses Effect Atom as the primary client server-state model for capability reads and mutations, especially those backed by Effect HTTP API contracts. TanStack Query may remain for TanStack Start compatibility or incidental tooling, but new starter capability data flows should not introduce a competing React Query abstraction.
