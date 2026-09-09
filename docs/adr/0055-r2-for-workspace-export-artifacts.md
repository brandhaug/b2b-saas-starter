# R2 for workspace export artifacts

Owner-authorized workspace exports run on a queue and write one gzipped JSON document to private R2 storage. Capability read projections exclude secrets and private audit metadata. R2 is reserved for export artifacts; the starter has no general upload workflow.

Artifacts expire after seven days. Download links use a per-export HMAC secret, last at most fifteen minutes, and never outlive artifact retention. Human links also sign the issuing user, session and Workspace. The API worker rechecks that session's five-minute authentication proof and current download permission before serving the object. Revoked sessions, removed factors and lost membership invalidate those links immediately. API Token links retain the machine-principal policy. Export jobs and downloads are audited without exposing bucket credentials.

R2 and queue configuration are optional; Seed builds the same archive in memory. Queued generation avoids a full workspace read in an HTTP request, and object storage keeps temporary archives out of the shared relational database.
