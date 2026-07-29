# Meta WhatsApp Adapter

This module owns Meta Cloud API protocol mapping behind Notifications provider ports:
controlled-template submission, effective-dated error and pricing classification,
callback schema decoding, and protected provider-reference correlation.

- Keep access tokens and raw provider references inside external I/O boundaries.
- Unknown submission outcomes and unknown error codes remain ambiguous; callback
  silence never becomes failure.
- Verify callback signatures over raw bytes in the API transport before invoking
  callback decoding or ingestion here.
- Persist callback receipts and normalized evidence before transport acknowledgement.
- Treat provider callbacks as duplicate and out-of-order facts; D1 and the lifecycle
  projection remain authoritative.
