# Controlled Template and Eligibility Engine

This module owns the provider-neutral policy applied before Messaging Balance
reservation or provider submission.

- Keep the catalog versioned and immutable. A send uses one exact
  locale-purpose-channel version; never silently upgrade it.
- Render only the controlled Appointment snapshot fields. Only confirmation may
  contain a URL.
- WhatsApp preserves Romanian diacritics and stays within the 500-character
  product envelope.
- SMS is deterministically transliterated to GSM-7 and must fit one 160-septet
  segment. Never truncate or submit multipart content.
- Eligibility is deterministic and returns a safe, exhaustive reason. It must
  honor Operational Messaging Permission, suppression, Merchant controls,
  provider configuration, exact template approval, and Shop-local reminder
  usefulness before financial or provider effects.
- Protected destinations may reveal plaintext only inside this module's
  protection operation and the later provider I/O adapter.
