# Deploying

`pnpm run deploy` provisions the Cloudflare resources declared in
[alchemy.run.ts](../alchemy.run.ts). This guide covers credentials, CI, previews,
and verification. See [local setup](setup.md) and the
[architecture](../ARCHITECTURE.md) for development and system boundaries.

## Support contacts

The public `/help/` page is available without a session or database read. Set
these optional web Worker variables to expose deployment support routes:

| Variable                  | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `SUPPORT_EMAIL`           | Email contact; offered alongside the helpdesk when both are configured |
| `SUPPORT_HELPDESK_URL`    | Primary support destination; must be an `https:` URL                   |
| `SUPPORT_HELP_CENTER_URL` | Optional documentation/help center; must be an `https:` URL            |

Invalid destinations are hidden. Configure a monitored mailbox or forwarding for
`SUPPORT_EMAIL`. Without a valid contact, `/help/` still offers diagnostic copying
and any configured help center. Copying prepares local details; it sends nothing.
Workspace-shell details include the authorized workspace ID; public help details
do not.

## One-time Cloudflare setup

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

Generate a separate auth secret with `openssl rand -base64 32`. Do not
reuse a development secret; the production env gate rejects known
placeholders outright when `ENVIRONMENT=production`.

## GitHub Actions secrets

The recommended path. The `deploy` job in
[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on pushes to `master` and manual `workflow_dispatch`, needs the `ci` and `e2e` jobs to pass first,
and reads its configuration from the `production`
[environment](https://docs.github.com/en/actions/reference/environments).
Create that environment (Settings → Environments → New environment),
then add these environment secrets:

| Secret                        | Required | Value                                                                               |
| ----------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`        | yes      | From step 2 above                                                                   |
| `CLOUDFLARE_ACCOUNT_ID`       | yes      | From step 1 above                                                                   |
| `BETTER_AUTH_SECRET`          | yes      | `openssl rand -base64 32`                                                           |
| `BETTER_AUTH_URL`             | yes      | The web Worker URL from step 3                                                      |
| `BETTER_AUTH_TRUSTED_ORIGINS` | yes      | Same value as `BETTER_AUTH_URL`                                                     |
| `CLOUDFLARE_EMAIL_FROM`       | no       | An address on a verified Email Sending domain; see [email setup](email-delivery.md) |
| `ENVIRONMENT`                 | no       | `production`, set by the workflow; no secret needed                                 |

Keep production values in the environment, not your local `.env`. The
`.env` file only needs local development defaults.

The workflow and Alchemy's `prod` stage set `ENVIRONMENT=production`, enabling
email verification and rejecting insecure auth secrets or URLs. Preserve that
value in customer deployments.

The workflow also forwards `SENTRY_DSN`, `MAINTENANCE_MODE`, and, when configured,
the independent security-evidence endpoint and token. See [operations setup](operations.md). To activate
optional providers (Stripe, Sentry, PostHog, Turnstile, Workers AI or
OpenAI, OTLP export), add each secret to the `production` environment and
forward it in the deploy job's `env` block. `packages/env/src/server.ts` owns
the key lists and secret classifications; the
[provider guide](../apps/web/content/docs/getting-started/optional-providers.mdx) explains activation. An unset optional provider degrades to inactive instead
of failing the deploy.

## Running a deploy

1. Open the repository's Actions tab and select the **CI** workflow.
2. Click **Run workflow**, keep the branch set to `master`, and run it.
3. Wait for `ci`, `e2e`, deployment, and the deployed-URL smoke checks.

Or, from a machine with the same variables exported:

```bash
pnpm run deploy
```

Both paths run `alchemy deploy --stage prod`. The stage is part of the
state-store identity, so always deploy with the same stage or the CLI
treats the stack as new.

## Preview stages per pull request

Every pull request opened from this repository (not from a fork, and not
by Dependabot) gets an ephemeral Alchemy stage named `pr-<number>`
([ADR 0065](./adr/0065-ephemeral-pr-preview-stages.md)). The
[Preview workflow](../.github/workflows/preview.yml) deploys it on
`opened`, `synchronize`, and `reopened`, applies the migrations, seeds
the Seed Workspace (`starter-lab`, demo sign-in in
[setup.md](./setup.md)), smoke-tests the API and web Workers, and reports
the stage through GitHub's Deployments API: the PR timeline carries a
"View deployment" link to the web Worker, and the workflow run's summary
holds all three URLs:

| Worker     | URL                                                                       |
| ---------- | ------------------------------------------------------------------------- |
| web        | `https://b2b-saas-starter-pr-<number>-web.<subdomain>.workers.dev`        |
| api        | `https://b2b-saas-starter-pr-<number>-api.<subdomain>.workers.dev`        |
| background | `https://b2b-saas-starter-pr-<number>-background.<subdomain>.workers.dev` |

Closing or merging the PR destroys its database, queues, and Workers. Stage
resource names in `infra/bindings.ts` isolate each preview from production and
other PRs.

Previews are provider-light on purpose. A `pr-<number>` stage drops
every optional provider value even if the deploying shell has one
(Turnstile, Stripe, Sentry, PostHog, OTLP, OpenAI, Workers AI, email)
and sets `ENVIRONMENT=preview`. A preview is publicly reachable and
signs in with the documented demo credentials, so never point one at
real data.

### Repository secrets for previews

The workflow reads **repository** secrets (Settings → Secrets and
variables → Actions), not the `production` environment:

| Secret                       | Required | Value                                                                                           |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`       | yes      | A token with the permissions from step 2 above; a separate token from production is a good idea |
| `CLOUDFLARE_ACCOUNT_ID`      | yes      | From step 1 above                                                                               |
| `PREVIEW_BETTER_AUTH_SECRET` | yes      | `openssl rand -base64 32`; shared by all preview stages, never the production value             |

`BETTER_AUTH_URL` is not a secret here: the workflow resolves the
account's `workers.dev` subdomain through the API and `alchemy.run.ts`
derives the URL from the stage's web Worker name.

### Running a preview stage from a laptop

The same scripts the workflow uses take the stage from `ALCHEMY_STAGE`
(or pass `--stage` to `alchemy` yourself; Alchemy also reads a plain
`STAGE` variable):

```bash
export CLOUDFLARE_API_TOKEN=…
export CLOUDFLARE_ACCOUNT_ID=…
export CLOUDFLARE_WORKERS_SUBDOMAIN='your-subdomain'   # or set BETTER_AUTH_URL explicitly
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"

ALCHEMY_STAGE=pr-42 pnpm run deploy:stage     # provision + migrate
ALCHEMY_STAGE=pr-42 pnpm run db:seed:stage    # seed the Seed Workspace
ALCHEMY_STAGE=pr-42 pnpm run destroy:stage --confirm-target="$CLOUDFLARE_ACCOUNT_ID/pr-42"
```

Pick any stage name matching `[a-z0-9]+([-_][a-z0-9]+)*`; only names of
the form `pr-<number>` get the preview rules above (providers dropped,
URL derived). A stage such as `dev_martin` gets isolated resources but
otherwise deploys like production, so it needs `BETTER_AUTH_URL`.

## Verifying the first deploy

1. Open `BETTER_AUTH_URL` and confirm the landing page renders.
2. Check the API Worker: `curl https://b2b-saas-starter-api.<subdomain>.workers.dev/health`
   returns 200.
3. Check `/ready` on web and API, then sign up through `/sign-up`. Production
   is not seeded automatically. Complete verification through the configured
   email provider and confirm a permitted workspace action.
4. Optional: promote your account to the system-admin role from the
   D1 console:

   ```bash
   pnpm exec wrangler d1 execute b2b-saas-starter --remote \
     --command "UPDATE user SET role = 'admin' WHERE email = 'you@example.com'"
   ```

## Ongoing deploys and rotation

Merging to `master` deploys after CI and E2E pass. The workflow also supports
manual dispatch. Adopters with customer data should protect the `production`
environment with required operator approval and disable automatic deployment
during incidents. Review schema changes before approving a deploy.

To rotate a secret, update it in the `production` environment and deploy again.
Keep a separately recoverable copy in the operator's secret manager. Alchemy
ships Worker secrets as write-only values, so account access alone cannot
recover them.

This repository has no production users and may squash migrations or reset
throwaway stages. That development policy does not apply to an adopter's
customer database. Preserve deployed migrations in your fork and add forward
migrations. The current baseline script only compares table names; it does not
prove that columns, indexes, constraints, or data transformations match. Do not
use it to certify a customer database after a squash. Replace the automatic
baseline step with reviewed migration history before customer deployment.

For a failed migration, stop deployment and follow the
[recovery decision path](operations.md#choose-the-recovery-action). Destroy/reseed
is restricted to disposable environments.

`pnpm run destroy --confirm-target="$CLOUDFLARE_ACCOUNT_ID/prod"` deletes
the database and its data. The command refuses a missing or mismatched target
confirmation. It is a teardown command, not a customer-data recovery procedure. Before first customer deployment,
complete the [recovery and monitoring setup](operations.md) and isolated drill.

## Troubleshooting

- `Invalid origin` on sign-in means the request origin is not in
  `BETTER_AUTH_TRUSTED_ORIGINS`. Add it and deploy again.
- Duplicate resource errors mean a resource with the same name already
  exists outside Alchemy's state store (created by hand or by another
  tool). Re-run with `--adopt` once to import it, then keep managing it
  through deploys.
- `Missing required deploy environment variable` means a required
  secret is missing from the `production` environment, or the job ran
  outside that environment.
