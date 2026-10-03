---
name: protected-local-preview
description: Share, verify, or stop a private local UI demo through an email-protected Cloudflare Quick Tunnel. Use for temporary browser reviews, not deployed PR previews or unattended webhooks.
---

# Protected local preview

Default to the public `/demo` UI with synthetic data. Tunnel admission protects
the local server; it does not sign visitors into Better Auth. Existing Alchemy
PR previews remain the deployed review workflow.

## Establish the target

1. Read [local setup](../../../docs/setup.md). Inspect this worktree's package
   scripts, Vite configuration, running process and startup output to identify
   the intended app and actual loopback port. A configured port alone is not
   proof: Vite may choose a different port when it is occupied. Confirm the local
   page belongs to this checkout and record the route to review.
2. Before starting a server or tunnel for a demo, obtain the user's exact email
   allowlist or explicit whole-domain choice, such as `*@example.com`. Never
   infer recipients from Git identity, repo examples, seeded users or a company
   name. An adoption/docs request authorizes preparation, not live exposure.
3. Review what the server exposes, including routes outside `/demo`, local data
   and active providers. A tunnel exposes the whole origin, not just the shared
   path. Use disposable synthetic data and inactive optional providers. Keep the
   server bound to loopback; the tunnel does not need a LAN listener. Resolve an
   ambiguous app, audience or sensitive-data scope before exposure.

For application sign-in or OAuth, read [application auth](references/application-auth.md)
before configuring or promising that flow. For unattended webhooks/API clients,
explain that browser email authentication cannot serve that use case and stop
this workflow. Quick Tunnels also do not support SSE. Route stable hostnames or
deployed reviews to [deployment guidance](../../../docs/deploying.md).

## Check protection support

Use installed help and [current Quick Tunnel docs](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#restrict-access-by-email).
These discovery commands do not open a tunnel:

```bash
cloudflared --version
cloudflared tunnel --help
pnpm exec wrangler --version
pnpm exec wrangler tunnel quick-start --help
```

Prefer `cloudflared` 2026.9.3 or newer with `--allowed-mail` in its help.
Wrangler is an alternative only when its installed `tunnel quick-start --help`
advertises `--allowed-mail`. A command named `quick-start` alone is insufficient.
If neither supports protection, stop and report the missing prerequisite with
the [Cloudflare install/update instructions](https://developers.cloudflare.com/tunnel/downloads/).
Never retry without protection, silently upgrade repo dependencies, or launch an
unprotected tunnel to test whether a flag works.

## Start and verify

Once the target and audience are established, start or reuse the intended local
server using its repo script. Probe the local review route and record an app
marker visible on that page. Choose one supported command below, substituting
the verified origin and actual authorized recipients. Examples are placeholders,
not an allowlist. Quote each value, especially wildcard domains; repeat the flag
for multiple recipients.

```bash
cloudflared tunnel --url 'http://localhost:VERIFIED_PORT' \
  --allowed-mail 'AUTHORIZED_EMAIL'
# Alternative, only when installed help confirms support:
pnpm exec wrangler tunnel quick-start 'http://localhost:VERIFIED_PORT' \
  --allowed-mail 'AUTHORIZED_EMAIL'
```

Run in a managed terminal that remains alive for the review. Record the session
handle and connector PID, plus the app PID only if this workflow started it.
With Wrangler, track its cloudflared child too. Keep logs local, outside tracked
files, and redact recipient addresses, cookies, PINs and auth callback URLs from evidence.

1. Inspect startup output for email authentication enabled and the expected rule
   count. Extract the generated HTTPS `trycloudflare.com` origin. A printed URL
   or a running process is not proof of protection. Stop the owned connector if
   protection is absent, ambiguous, or startup fails.
2. Probe the generated URL plus the review route with a fresh, cookie-free GET.
   Set `PREVIEW_URL` to the observed origin, then for `/demo`:
   `curl -q --max-time 15 -sS -D /tmp/preview-headers -o /tmp/preview-body "$PREVIEW_URL/demo"`.
   Inspect the response without forwarding stored credentials. Expect Cloudflare's
   email sign-in challenge or redirect, not the local page marker. A generic
   error, app sign-in page or HTTP status alone does not prove enforcement.
   If app content appears unauthenticated, stop the connector immediately.
   If the probe is inconclusive, stop it while diagnosing the local origin or
   connection failure; retry only with protection and repeat the checks.
3. If Vite rejects the generated host after tunnel authentication, keep the
   tunnel protected and restart only the owned app process with the exact
   hostname in `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`. See
   [Vite host configuration](https://vite.dev/config/server-options.html#server-allowedhosts).
   For a reused app owned by someone else, coordinate its restart with the owner
   or use a separately owned local server and re-establish the tunnel target.
   Preserve the verified port and loopback binding. Never allow all hosts or
   the whole `trycloudflare.com` domain. Repeat local and external probes.
4. Give the user the review URL and ask an allowed human to complete the email
   challenge in their browser. Do not fetch their PIN or impersonate them.
   Confirm the expected app marker, route and UI navigation after admission.
   Record whether you observed the browser or the human reported the result.
   If an authorized tester with a non-allowed mailbox is available, verify denial
   too; record that case as untested otherwise. The fresh anonymous probe proves
   a challenge, not every allowlist rule.

Until the human check finishes, label the link "challenge verified; app behind
tunnel unverified". Handoff includes the URL with useful path, selected local
origin, observed checks and gaps, process owner, and exact stop action. Do not
publish URLs or recipient lists to repository docs, PRs or public artifacts.

## Stop or change access

Send Ctrl-C to the recorded terminal or SIGTERM to the verified owned connector
PID. With Wrangler, verify both parent and child exit. Avoid blanket process
kills. Confirm exit and recheck the old URL, including an admitted browser if
available, until it no longer reaches the local app. Record any verification gap;
a surviving challenge page alone does not mean the app is reachable.

To revoke one recipient, stop the old connector first, then start a new protected
tunnel with the revised explicit allowlist and repeat verification. Do not
promise a stable URL or an in-place policy update. Stop the local app only if this
workflow started it and it is no longer needed. Remove temporary host/auth
overrides and local evidence containing session data.

## Sources and maintenance

The [launch post](https://blog.cloudflare.com/protected-quick-tunnels/) establishes
the cloudflared version floor and supported Wrangler syntax. The
[release note](https://developers.cloudflare.com/changelog/post/2026-10-02-protected-quick-tunnels/)
documents email/domain rules and revocation by process exit. Recheck installed
help on every run; published availability does not prove local CLI support.

When changing this skill, use the offline requests in
[scenario validation](references/scenarios.md), then report separately which
live checks actually ran.
