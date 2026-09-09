# Verify deployment encryption

Assess encryption at rest and in transit for every applicable path in the
[data inventory](security-checklist.md#data-inventory). The target is AES-256 at
rest and TLS 1.2 or later in transit. Servers and authorized operators can process
plaintext. This is not end-to-end encryption.

Keep the dated assessment with the operator's private records. Record deployment,
revision, assessor, provider/product, configuration observation, source link,
result, and remaining action. Never include keys, tokens, signed download URLs,
payloads, or raw environment dumps. A provider statement and a repository test
prove different things; neither proves every deployed path meets the target.

## Provider evidence and settings

The sources below were reviewed on 2026-09-09. Recheck them when providers or
contracts change. A gap means the stated target is unverified, not that a provider
necessarily stores plaintext. Obtain product-specific evidence from the provider
or keep that path out of customer use pending an operator decision.

| Path                                                                                                  | Evidence and ownership                                                                                                                                                                                                                                                                                                                | Deployment observation to retain                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared D1, auth fields, audit data and database recovery copies                                       | [D1 data security](https://developers.cloudflare.com/d1/reference/data-security/) states automatic AES-256 for stored objects, metadata and live/inactive databases, with Cloudflare-managed keys. It documents TLS for Worker/internal/API transfers but does not specify an internal minimum version.                               | Confirm each Worker's DB binding and deployed database identity. Record Time Travel coverage and request confirmation of its recovery-copy scope and internal TLS minimum if required. There is no application encryption toggle.                             |
| Private R2 Workspace Exports                                                                          | [R2 data security](https://developers.cloudflare.com/r2/reference/data-security/) states automatic AES-256 for objects and metadata with provider-managed keys, and TLS for client transfer.                                                                                                                                          | Confirm the export binding points to the assessed bucket. Verify public access, `r2.dev` and public custom domains are disabled. Downloads must pass API authorization. Record the binding transport assurance separately from public download TLS.           |
| Queues and all dead-letter queues                                                                     | [Queues documentation](https://developers.cloudflare.com/queues/) describes delivery but the reviewed material did not establish product-specific AES-256 or internal TLS 1.2 guarantees. **Evidence gap.** D1/R2 guarantees do not establish Queue guarantees.                                                                       | Inventory every producer, consumer, queue and dead-letter queue from deployed bindings. Obtain provider evidence for stored messages, replicas and internal transport.                                                                                        |
| Worker logs and traces; Sentry, PostHog and OTLP                                                      | [Sentry security](https://sentry.io/security/) and [PostHog's security handbook](https://posthog.com/handbook/company/security) provide assessment entry points. The reviewed pages do not establish the exact algorithm and transport minimum for every configured sink. **Evidence gap until product-specific terms are retained.** | Record active sinks and regions, HTTPS endpoints, retention and access settings. Include the collector's downstream storage and forwarding. Self-hosted deployments need their own storage/key evidence. See [monitoring](monitoring.md).                     |
| Stripe                                                                                                | [Stripe's DPA](https://stripe.com/legal/dpa) states AES-256 for production data in server infrastructure and TLS 1.2 for inbound/outbound connections. These are provider-managed controls.                                                                                                                                           | Confirm the deployed Stripe account, API destination and webhook callback origin. Retain the applicable agreement and account access review.                                                                                                                  |
| Email, recipient mailboxes, identity providers, Turnstile, Workers AI and OpenAI-compatible providers | Provider selection determines the evidence required. HTTPS to an API does not prove AES-256 storage, encrypted SMTP delivery or recipient mailbox encryption. **Evidence gap for each unassessed recipient.**                                                                                                                         | Inventory enabled providers and identity connections, their API/discovery/token endpoints, email onward delivery and retained copies. Obtain their product-specific guarantees. Record unsupported mail delivery or destination guarantees explicitly.        |
| Independent S3-compatible backups                                                                     | [Backup tooling](../scripts/d1-backup.ts) encrypts SQL and authenticated completion records with AES-256-GCM before upload. Bucket metadata, access logs, version copies and temporary plaintext need separate coverage.                                                                                                              | Verify HTTPS endpoint and certificate validation, bucket/account independence, storage encryption, lifecycle, access policy and separately recoverable keys. Retain a successful authentication/decryption drill using [backup recovery](backup-recovery.md). |
| Independent security-evidence service                                                                 | HTTPS configuration protects the configured request destination; its storage and internal transport are operator-owned. **Provider/storage evidence gap until assessed.**                                                                                                                                                             | Record append-only service destination, TLS policy, storage algorithm, access restrictions and coverage of every restorable interval. Follow [evidence custody](operations.md#independent-security-evidence-store).                                           |
| Worker secrets, CI secrets, Alchemy state and operator devices                                        | [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) are hidden after creation. That property alone does not prove a particular storage cipher. **Algorithm evidence gap for unassessed secret/state stores.**                                                                                          | Inventory deployment, backup and operator secret stores, Alchemy's state backend, CI logs/artifacts and local export/drill files. Retain provider cipher evidence, access review and device disk-encryption evidence.                                         |

## Inbound and outbound transport

Inventory the web Worker's pages, server functions, auth/OAuth callbacks and
provider webhooks; the API Worker's REST, MCP, export download, reference and
health/readiness routes; and the background Worker's Stripe webhook endpoint. Include every
custom domain, `workers.dev` hostname, version preview, alias and any alternate
origin. Static assets can be served before Worker code, so verify them separately.

For each production custom domain, set Cloudflare's
[Minimum TLS Version](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/minimum-tls/)
to at least 1.2 and enable HTTPS enforcement. Use Full (strict) when a route
forwards to a separate origin. Keep certificates valid. Disable unused
[`workers.dev` routes](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
and preview URLs in deployment configuration, then verify they remain disabled
after deployment. Zone settings must not be assumed to cover alternate hosts.

Alchemy and generated Wrangler configuration disable per-version preview URLs.
The normal `workers.dev` address remains enabled because the starter and PR stages
use it as their public address. An adopter switching to custom domains must
explicitly disable that remaining address and verify the deployed result.

Worker request checks can reject HTTP and old TLS before application handling,
using trusted `request.cf.tlsVersion` metadata. This happens **after** the TLS
handshake and cannot prevent a client sending data over an old connection.
Where a provider-managed hostname cannot enforce the required handshake minimum,
record the limitation and use a controlled custom domain with the bypass disabled
before claiming the transport target. Never trust a client-supplied TLS header.

Review configured auth/trusted origins, API/export origin, MCP issuer/resource,
Sentry DSN, PostHog host, OTLP collector, AI base URL and independent evidence URL.
Also review stored SSO discovery/token endpoints and customer Webhook Endpoints,
fixed Stripe/social-login/Turnstile APIs, Cloudflare bindings and backup/monitoring
CLI destinations. Require HTTPS for active production endpoints. Verify all
redirect hops; a secure initial URL alone does not prove a secure destination.
Worker `fetch` and third-party SDKs do not expose the same per-request TLS minimum
controls as an operator TLS client. Retain provider guarantees or a measured
configuration result and mark unobservable internal hops unverified. Do not
disable certificate verification. Local HTTP endpoints are for local development.

## Repeatable transport observations

Use credential-free requests against a known harmless path. With a curl build
that supports the selected protocol versions, run these separately for every
hostname. Replace the example with a reviewed public endpoint, never a signed URL.

```sh
curl --silent --show-error --max-time 15 --tlsv1.2 --tls-max 1.2 \
  --output /dev/null --write-out 'status=%{http_code} verify=%{ssl_verify_result}\n' \
  https://api.example.com/health
curl --silent --show-error --max-time 15 --tlsv1.1 --tls-max 1.1 \
  --output /dev/null --write-out 'status=%{http_code} verify=%{ssl_verify_result}\n' \
  https://api.example.com/health
curl --silent --show-error --max-time 15 --tlsv1.0 --tls-max 1.0 \
  --output /dev/null --write-out 'status=%{http_code} verify=%{ssl_verify_result}\n' \
  https://api.example.com/health
curl --silent --show-error --max-time 15 --output /dev/null \
  --write-out 'status=%{http_code}\n' http://api.example.com/health
```

TLS 1.2 must succeed with a valid certificate on a deployment that supports 1.2;
a deliberately TLS-1.3-only deployment needs a 1.3 positive control. Old-protocol
handshakes should fail at the edge. An application rejection establishes only
request rejection. A local unsupported-protocol error, timeout or DNS failure
is **not checked**, not proof of server rejection. Confirm a working positive
control and inspect the error privately. HTTP must redirect safely or reject
without serving application data. Do not send credentials during these probes.

Also test a synthetic HTTP provider URL against production configuration and
confirm the error names the setting without echoing its value. Test unset optional
providers and local HTTP separately. Retain test command, revision and pass/fail
summary. Passing configuration tests does not inspect remote disks or prove
certification, readiness or operating effectiveness.

Run the repository's transport configuration tests with
`pnpm -C packages/env test`. The [shared transport checks](../packages/env/src/transport.ts)
inspect passed configuration and trusted Worker metadata without querying a
provider. [SSO discovery tests](../apps/web/src/lib/server/sso-discovery.test.ts)
exercise accepted and rejected identity endpoints. The
[AI transport test](../packages/ai/src/openai.test.ts) uses a local redirecting
server to verify that a redirect target receives no prompt. These are local
regression checks; retain separate deployed observations.

A synthetic run on 2026-09-09 produced the following sanitized audit results.
The negative URL included userinfo and a query token; neither appeared in the
reported problem. "Accepted" here means the configuration audit accepted the
supplied values, not that any provider or deployment was verified.

| Input scenario                                         | Configuration result                    |
| ------------------------------------------------------ | --------------------------------------- |
| HTTPS production auth, API, AI and Sentry destinations | Accepted                                |
| Production AI destination using HTTP                   | Rejected: `OPENAI_BASE_URL`, `insecure` |
| Local AI destination using HTTP                        | Accepted                                |
| Unset optional providers                               | Accepted                                |

## Key custody, rotation and recovery

Cloudflare owns D1/R2 encryption keys and their provider rotation. Operators own
account access, API token scope and recovery access; the starter exposes no
per-Workspace key or independent per-Workspace database recovery. Request provider
key-management evidence when reviewing the managed guarantees.

Keep `BACKUP_ENCRYPTION_KEY` separate from bucket credentials and production
Cloudflare access, with an independently recoverable secret-manager copy. The
current tool accepts one key per invocation. Record the key version and covered
backup dates privately. To rotate, preserve the old key, change the scheduled
writer's key and prefix, create a backup, then exercise restore with the new key.
Test an older retained backup with its matching key and prefix. Changing prefixes
means old-prefix retention needs explicit operator handling. Do not delete an old
key while a required backup still depends on it. Never put the key into the record.

Auth enables `encryptOAuthTokens` in [auth configuration](../packages/auth/src/index.ts).
The pinned Better Auth 1.7.2 implementation uses XChaCha20-Poly1305 for this extra field
protection; AES-256 at rest comes from D1. Do not label OAuth field encryption
AES-256. The configured auth secret also affects other auth material. Preserve
the matching secret for recovery. A blind replacement can make stored encrypted
fields unreadable; this starter does not provide an online key migration command.
Plan and test reauthorization, factor recovery and session invalidation in an
isolated copy before rotation. Follow [system closure and reopening](operations.md)
and the [recent-authentication policy](strong-authentication.md).

Rotate provider/API credentials at their issuer, update the deployment secret
store, deploy and verify the affected operation, then revoke the superseded
credential. Limit secret read/write and deploy rights separately where possible.
Anyone able to deploy Worker code can potentially read its bound secrets.
Inventory webhook/export signing keys separately from encryption keys; signing
does not encrypt the payload. Record owner, purpose, last rotation and tested
recovery location without storing secret values. Follow [deployment rotation](deploying.md#ongoing-deploys-and-rotation).

## Observed reference deployment

On 2026-09-09, authenticated, read-only `wrangler deployments list` and
`wrangler versions view` observations confirmed all three reference Workers used
`ENVIRONMENT=production` and the same D1 database binding. GitHub recorded a
successful production deployment of `4fb1b835` at 08:18 UTC; the observed Worker
versions were created at the same time. The D1 binding plus the provider statement
above supports the managed AES-256 storage assessment. No disk or key material
was inspected. Keep exact version identifiers and live negative probe results
in private operator records, following the [security policy](../SECURITY.md).

The web auth URL and trusted-origin configuration began with HTTPS. Auth used a
`secret_text` binding. Queue bindings were present for webhook and
notification work, with billing on web/background. No R2 export binding or
Sentry, PostHog, OTLP, Stripe, external AI or independent-evidence configuration
appeared in these versions. AI bindings existed on web/API; that alone does not
establish provider activation. Email bindings and sender configuration existed
on all three Workers.

Raw binding values and credentials were excluded from the retained output.
Queue encryption/internal transport, email delivery, historical previews,
backup-account configuration, Alchemy state and operator key custody remain
unverified. Repeat the inventory and probes after deployment and before enabling
an additional provider.
