# Subscription refund decisions

Operations owns the staff-facing decision workflow. It may explicitly invoke the
Subscriptions capability, but callers must provide only a retained provider event
identifier and the chosen consequence. Merchant identity, provider references, and
refund kind are derived from signed retained evidence and are never accepted from
the operator request.
