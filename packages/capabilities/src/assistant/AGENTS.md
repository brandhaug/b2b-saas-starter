# Assistant persistence

The directory owns immutable conversation addresses and content policy revisions. Admission coordinates Member limits across conversation objects. Lifecycle collects private personal exports and retries object deletion through the host port. Live conversation transcripts and attempt idempotency belong to the Durable Object. Seed uses an isolated in-memory host with the same admission service and lifecycle ports. Both hosts call the capability-owned execution workflow and SSE observation protocol.

## Contracts

- A directory row contains metadata only. Titles, questions, evidence and answer text stay in the object. Resolve current authority before reading the object, then check the directory revision again before disclosing its snapshot.
- Required permissions only grow. `raisePolicy` unions them in SQL before evidence is saved. An ambiguous failure retains the stricter policy. Access changes also advance the revision, invalidating previously generated archives even after membership restoration. Membership, role and suspension changes additionally advance `runAccessRevision`; accepted answers retain that revision so restoring access cannot resume earlier work. Credential-specific invalidation leaves this run revision unchanged. Member invalidation scopes include both Workspace and creator identity.
- `reserve` uses a single conditional D1 insert for both concurrency and rolling rate limits. The object serializes admission, persists accepted input, then calls `commit` before provider execution. Duplicate reservation IDs cannot move across identities. `release` is idempotent; ambiguous reservations expire at the attempt deadline plus shutdown grace. Released reservations still count toward the rolling minute.
- A deletion fence hides the conversation and releases slots before cleanup. Directory tombstones retain immutable addresses after account or Workspace removal and successful object cleanup. Parent-deletion triggers protect plugin paths and concurrent teardown. Never cascade these rows or reuse a fenced conversation ID.
- Ordinary `SeedLayer` can browse, manage and export conversations without a provider; generation remains unavailable and reserves nothing. `makeSeedCapabilitiesLayer` accepts an explicit conversation model only for synthetic tests and demos.
- Personal exports carry conversation IDs and policy revisions. The lifecycle host rechecks current session, membership, permissions and assurance for every export and cached download. Workspace export collectors never include conversation content.

- Execution policy belongs in `developer-platform/assistant-conversation-execution.ts`: current authority, metadata, deadline and failure outcomes, terminal writes and quota release. Host adapters supply ledger operations, event delivery and output persistence; SQLite also owns SDK recovery and sockets. Finalization persists partial output before terminal completion and preserves an already committed Stop or interruption.
- SSE changes belong in `developer-platform/assistant-conversation-events.ts`. Seed and SQLite share replay IDs, suffix events, snapshot fallback and terminal refusal output.

## Verification

The shared directory and lifecycle contracts run against Seed and migrated local D1. The observation contract runs against Seed and the native host. Keep concurrent admission, deadline expiry, policy races, export invalidation, identity-owned deletion and failed cleanup cases equivalent. Seed membership and suspension use the same directory instance as the conversation services.
