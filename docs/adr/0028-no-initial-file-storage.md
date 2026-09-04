# No initial file storage

The starter does not include R2 or user file upload workflows in the initial scaffold because the workspace, API, MCP, and admin domains do not require file storage. Cloudflare storage extensions can be discussed in educational content, but working upload surfaces are out of scope until a concrete product workflow needs them.

One workflow has since needed object storage: the Workspace Export (ADR 0055) writes its ZIP artifacts to a single, env-gated R2 bucket with a seven-day lifecycle rule. That bucket holds export artifacts only — no user uploads, no general file storage — and the starter still ships no upload surface; the rest of this decision stands.
