# Notification Intent Execution

This module owns due-work discovery and provider-neutral execution of prepared
Notification Intents. The Background Worker supplies wake-ups and recovery ticks;
it must not interpret appointment state, eligibility, routing, or provider outcomes.

- Recheck authoritative eligibility before reservation and again before submission.
- Persist the Submission Attempt before revealing a destination or calling a provider.
- Never hold a D1 transaction across a provider call.
- Persist the normalized response evidence before returning success to a Queue handler.
- Treat an orphaned write-ahead attempt as Submission Unknown after the short stale
  window; never resubmit it automatically.
- Keep Queue and recovery work bounded globally and per Shop. Queue loss may add
  latency, but D1 due-work discovery must retain authority.
- Local and test runtimes use deterministic, redacted provider capture. Preview and
  production fail closed until their provider adapters are installed.
- Email and Platform Webhook work remain independent booking-outbox lifecycles.
