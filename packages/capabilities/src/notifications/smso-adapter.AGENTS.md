# SMSO.ro Adapter

This module owns the provider-specific SMSO.ro HTTPS boundary for the single
platform SMS fallback route. Submission is form encoded, transactional, and
limited to one GSM-7 segment. A response token is protected before acceptance
becomes durable, and provider-reported response cost is captured separately
from the Merchant charge.

SMSO.ro callbacks are unauthenticated hints. They may wake polling only after a
unique protected-reference match and must never mutate delivery state. Only a
bounded status query made from an internally stored encrypted response token
can produce trusted Provider Evidence. Keep duplicate query identities stable,
terminal projection monotonic, and ambiguous submission non-replayable.

Local and test runtimes continue to use deterministic capture. Preview and
production select this adapter only when every required provider and
provider-reference secret is configured; otherwise the route is explicitly
`needs_configuration`.
