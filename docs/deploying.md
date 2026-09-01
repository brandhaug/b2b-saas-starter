# Deploying

This guide covers deploying the starter to Cloudflare: one-time account
setup, the secrets GitHub Actions needs, the deploy command, and how to
verify the result. `pnpm run deploy` provisions everything with
[Alchemy](https://alchemy.run): the D1 database (with migrations), the
webhook queue and dead-letter queue, the three Workers (`web`, `api`,
`background`), their bindings, rate limiters, and Workers Observability.
Optional providers (Stripe, Sentry, PostHog, Turnstile, email, AI) stay
inactive until you add their variables.

For the full resource and security model, see
[ARCHITECTURE.md](../ARCHITECTURE.md) (Deployment & Infrastructure and
Secret matrix). For local setup, see [setup.md](./setup.md).

## One-time Cloudflare setup

Create the two values every deploy needs, plus the URL users will visit.

1. Find your **account ID**: run `pnpm exec wrangler whoami`, or open the
   Cloudflare dashboard and copy it from the Overview sidebar.
2. Create an **API token** at
   [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).
   Start from the "Edit Cloudflare Workers" template, then add these
   permissions:

   | Permission       | Level |
   | ---------------- | ----- |
   | Workers Scripts  | Edit  |
   | D1               | Edit  |
   | Queues           | Edit  |
   | Email Sending    | Edit  |
   | Account Settings | Read  |

   The token is the only credential the CLI cannot create for you, and
   the only one `pnpm run deploy` requires.

3. Determine **`BETTER_AUTH_URL`**, the public URL of the web Worker.
   With no custom domain it is
   `https://b2b-saas-starter-web.<subdomain>.workers.dev`, where the
   subdomain appears in the dashboard under Workers & Pages, or from:

   ```bash
   curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain"
   ```

   The value must match where users actually browse: it feeds auth
   redirects, verification links, and origin checks. If you later attach
   a custom domain, update the URL (and trusted origins below) and
   deploy again.

Generate the auth secret now too — `openssl rand -base64 32`. Do not
reuse a development secret; the production env gate rejects known
placeholders outright when `ENVIRONMENT=production`.

## GitHub Actions secrets

The recommended path. The `deploy` job in
[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs only on
manual `workflow_dispatch`, needs the `ci` and `e2e` jobs to pass first,
and reads its configuration from the `production`
[environment](https://docs.github.com/en/actions/reference/environments).
Create that environment (Settings → Environments → New environment),
then add these environment secrets:

| Secret                        | Required | Value                                                                                   |
| ----------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`        | yes      | From step 2 above                                                                       |
| `CLOUDFLARE_ACCOUNT_ID`       | yes      | From step 1 above                                                                       |
| `BETTER_AUTH_SECRET`          | yes      | `openssl rand -base64 32`                                                               |
| `BETTER_AUTH_URL`             | yes      | The web Worker URL from step 3                                                          |
| `BETTER_AUTH_TRUSTED_ORIGINS` | yes      | Same value as `BETTER_AUTH_URL`                                                         |
| `CLOUDFLARE_EMAIL_FROM`       | no       | A verified Email Routing destination address; leave unset to skip the SendEmail binding |

Keep production values in the environment, not your local `.env`. The
`.env` file only needs local development defaults.

The workflow forwards exactly these six variables. To activate optional
providers (Stripe, Sentry, PostHog, Turnstile, Workers AI or OpenAI,
OTLP export), add each secret to the `production` environment and
forward it in the deploy job's `env` block — the key lists and the
secret-vs-plain split live in `packages/env/src/server.ts`, and the
[secret matrix](../ARCHITECTURE.md#secret-matrix) documents what each
one activates. An unset optional provider degrades to inactive instead
of failing the deploy.

## Running a deploy

1. Open the repository's Actions tab and select the **CI** workflow.
2. Click **Run workflow**, keep the branch set to `master`, and run it.
3. Wait for the `ci` and `e2e` jobs, then the `deploy` job. A full first
   deploy takes a few minutes; an up-to-date re-deploy finishes faster.

Or, from a machine with the same variables exported:

```bash
pnpm run deploy
```

Both paths run `alchemy deploy --stage prod`. The stage is part of the
state-store identity, so always deploy with the same stage or the CLI
treats the stack as new.

## Verifying the first deploy

1. Open `BETTER_AUTH_URL` — the landing page should render.
2. Check the API Worker: `curl https://b2b-saas-starter-api.<subdomain>.workers.dev/health`
   returns 200.
3. Sign up through `/sign-up`. The seed script only fills the local
   database, so the deployed database starts empty.
4. Optional: promote your account to the system-admin role from the
   D1 console:

   ```bash
   pnpm exec wrangler d1 execute b2b-saas-starter --remote \
     --command "UPDATE user SET role = 'admin' WHERE email = 'you@example.com'"
   ```

## Ongoing deploys and rotation

Merging to `master` does not deploy. Run the workflow again, or run
`pnpm run deploy` locally with the production variables. To rotate a
secret, update the value in the `production` environment (or your shell)
and deploy again — Alchemy ships values as write-only Worker secrets, so
they are never readable back from Cloudflare. To add a schema change,
commit the generated migration; the deploy applies it to D1
automatically.

To tear everything down, run `pnpm run destroy`. This deletes the
database and its data.

## Troubleshooting

<!-- prettier-ignore -->
> [!CAUTION]
> A green deploy job that finishes in seconds deployed nothing. A real
> first deploy provisions resources and takes minutes; if the job ends
> immediately, confirm Workers & Pages lists the three Workers before
> trusting the run.

- **`Invalid origin` on sign-in** — the request origin is not in
  `BETTER_AUTH_TRUSTED_ORIGINS`. Add it and deploy again.
- **Duplicate resource errors** — a resource with the same name already
  exists outside Alchemy's state store (created by hand or by another
  tool). Re-run with `--adopt` once to import it, then keep managing it
  through deploys.
- **`Missing required deploy environment variable`** — a required
  secret is missing from the `production` environment, or the job ran
  outside that environment.
