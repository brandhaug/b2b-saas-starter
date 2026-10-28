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
2. Provision the deployment token with the [bootstrap stack](#deployment-token-bootstrap),
   or create a custom token with the permissions below, scoped to **only the
   deployment account**. Avoid the broader Workers template.

   | Permission       | Level | Required for                                                    |
   | ---------------- | ----- | --------------------------------------------------------------- |
   | Workers Scripts  | Edit  | Workers, assets, bindings, cron schedules, queues and consumers |
   | D1               | Edit  | Database provisioning and migrations                            |
   | Secrets Store    | Edit  | Alchemy state-store creation and upgrades                       |
   | Account Settings | Edit  | Production Web Analytics site management                        |
   | Account Settings | Read  | Web Analytics site discovery during Alchemy planning            |

   Add **Workers R2 Storage → Edit** only when workspace exports are enabled.
   These are account-wide grants within the selected account, not restrictions
   to this app's Worker names. Use a separate account when that boundary is needed.

3. Deployment discovers the account's existing `workers.dev` subdomain and derives
   Worker URLs automatically. Auth URL, trusted origin, API public URL, analytics
   hostname, and CI smoke targets use the same origin resolver. No URL secrets
   need to be copied into GitHub.

   To attach custom domains, configure `production.domains` in
   [deployment.config.ts](../deployment.config.ts), for example:

   ```ts
   domains: {
     web: { name: 'app.your-domain.net', zoneId: '<32-character-zone-id>' },
     api: { name: 'api.your-domain.net', zoneId: '<32-character-zone-id>' }
   }
   ```

   Each zone must already belong to the deployment account. Alchemy attaches the
   domains and Cloudflare manages their DNS records and certificates. Explicit
   zone IDs avoid zone discovery; the existing Workers Scripts Edit grant covers
   the Workers Domains API. No DNS Edit or zone-wide route grant is added.
   Previews always use their own workers.dev URLs and ignore production domains.

   Additional public DNS records, such as domain-verification TXT records, belong
   in the opt-in `dns.config.ts` operator stack. It defaults to disabled and is
   separate from application deployment. For example:

   ```ts
   const dns: DnsSettings = {
     enabled: true,
     accountId: '<32-character-account-id>',
     records: [
       {
         key: 'service-verification',
         zoneId: '<32-character-zone-id>',
         type: 'TXT',
         name: '_verify.your-domain.net',
         content: 'public-verification-value'
       }
     ]
   }
   ```

   Use an operator credential with Zone Read and DNS Write scoped to the declared
   zones. Run `pnpm run bootstrap:dns:plan`, then `pnpm run bootstrap:dns` to apply
   the reviewed configuration. Both commands use production-only local operator
   state. The stack verifies zone account ownership and rejects record names
   outside their zone or at configured Worker custom-domain hostnames. Configured
   record names must be lowercase FQDNs without trailing dots. Declare at most
   one record for each zone/name/type: the current native provider can treat a
   second same-name/type record as adoption of the first even when values differ.
   Existing multi-value RRsets therefore remain outside this stack.
   Cloudflare already owns DNS/certificates for Worker hostnames; do not declare them
   twice. Keep the operator state backed up. Removing a managed DNS record from
   configuration plans its deletion. Native Alchemy adoption checks protect
   pre-existing records; use `--adopt` only after verifying the specific matches.
   DNS values are public: never place API tokens or other secrets in this file.

Bootstrap generates a stable production auth secret with `Alchemy.Random`.
On first adoption this replaces the previous `BETTER_AUTH_SECRET`, invalidating
existing sessions. Later applies preserve it in bootstrap state.

## Deployment token bootstrap

[alchemy.bootstrap.ts](../alchemy.bootstrap.ts) owns a new account API token,
the repository's `CLOUDFLARE_API_TOKEN` Actions secret, and the production
environment's configuration. Its permission policy lives
in [deployment-token-policy.ts](../scripts/lib/deployment-token-policy.ts).
The app deploy does not run this stack.

Run bootstrap from a **persistent operator checkout**. It uses local Alchemy
state, separate from the app's Cloudflare state store, so bootstrap requires no
Worker, D1, or Secrets Store access. The bootstrap credential needs
[Account API Tokens → Edit](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/create/)
for the target account. Keep it out of GitHub Actions; CI receives only the
generated deployment token. Permission changes require this operator credential
again, not just the initial setup.

GitHub authentication uses Alchemy's GitHub provider through `GITHUB_TOKEN`.
To use an authenticated `gh` session, run `export GITHUB_TOKEN="$(gh auth token)"`
before bootstrap. The pinned Alchemy version does not discover the CLI login
automatically. A fine-grained token needs **Administration, Environments,
Secrets, and Variables → Read and write**, plus **Actions → Read**, on this
repository only. Administration manages environments and branch policies; Actions
Read lists their policies. The existing `gh` login can also supply access.

Edit [deployment.config.ts](../deployment.config.ts) for required reviewers and
public provider/support/privacy variables. The branch is constrained to `master`,
matching the current CI workflow; changing that deployment convention requires
updating the workflow and the configuration type together. Empty reviewers
preserve automatic deploys; configured reviewers enable self-review prevention.
The production environment permits only the configured branch. Bootstrap owns
these settings and reconciles dashboard edits on its next apply. Bootstrap uses
`--force` so environment policies and write-only secrets are reapplied even when
the local configuration is unchanged; generated Random values remain stable.

List external provider secret names in `production.secrets`, then privately export
their values as `BOOTSTRAP_<name>` before bootstrap (for example,
`BOOTSTRAP_STRIPE_SECRET_KEY`). Only explicitly selected secrets are read. Missing
selected values fail setup; unselected providers stay inactive. GitHub OAuth keys
are mapped to the `OAUTH_GITHUB_*` names expected by CI. Existing unmanaged secrets
are left alone; removing a previously managed entry deletes that entry in GitHub.

Export the bootstrap credential as `CLOUDFLARE_API_TOKEN` privately in your shell,
then set the non-secret inputs:

```bash
export CLOUDFLARE_ACCOUNT_ID='<deployment-account-id>'
export BOOTSTRAP_GITHUB_REPOSITORY='<owner>/<repository>'
export WORKSPACE_EXPORTS_ENABLED=false
# Optional: a separate account, never the production account.
export BOOTSTRAP_PREVIEW_ACCOUNT_ID='<preview-account-id>'
pnpm run bootstrap:plan
pnpm run bootstrap:deploy
unset CLOUDFLARE_API_TOKEN
```

The commands use `umask 077`. Local `.alchemy/state/b2b-saas-starter-deployment-access/prod/`
contains the generated token in **plaintext**, despite redaction in CLI output.
Restrict access to the checkout and keep an encrypted backup of that state.
Never commit it or upload it as a CI artifact. Losing it requires issuing a new
token: Cloudflare cannot return an existing token's value. A fresh checkout does
not adopt the old token. If GitHub publication fails after token creation, retain
the state and rerun bootstrap from the same checkout.

Applying the stack replaces the repository secret value. It does not revoke the
previous token. An existing `production` environment secret with the same name
overrides the repository secret; remove that override before verifying the new
credential. Run CI and confirm deployment plus smoke checks before revoking the
previous token. To recover from a failed rollout, restore the previous repository
secret with `gh secret set CLOUDFLARE_API_TOKEN` using its private input prompt.
Keep the previous credential available until verification finishes. Do not destroy
the bootstrap stack to roll back: destroy removes its token and GitHub secret.

Set `WORKSPACE_EXPORTS_ENABLED=true` for bootstrap before enabling exports in CI.
When disabling exports, first deploy the app with exports disabled (while the
token still has R2 access, so Alchemy can delete the bucket), then rerun bootstrap
with the flag false. Reapply bootstrap from the same checkout after policy edits;
it updates the managed token in place and republishes the secret.

### Permission evidence and verification

Cloudflare documents Edit as
[full CRUDL access](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).
The [queue](https://developers.cloudflare.com/api/resources/queues/methods/create/)
and [consumer](https://developers.cloudflare.com/api/resources/queues/subresources/consumers/methods/create/)
APIs accept Workers Scripts Write, so a separate Queues grant is unnecessary.
Email and AI are Worker bindings; their runtime use does not require granting
the deployment token Email Sending or Workers AI API access. Observability is
Worker upload metadata. This stack provisions neither Pages, KV, Containers,
Workers CI nor zone routes, and needs none of their permission groups.

The [RUM list endpoint](https://developers.cloudflare.com/api/resources/rum/subresources/site_info/methods/list/)
requires explicit Account Settings Read alongside the Write grant used for
[creation](https://developers.cloudflare.com/api/resources/rum/subresources/site_info/methods/create/).
A live account-token probe on 2026-10-14 returned HTTP 403 with Write alone and
HTTP 200 after adding only Read to the same token. The default policy includes
both grants. Account-owned tokens worked for this list endpoint. If RUM returns
Forbidden, verify the exact credential, account, and both grants before widening
the policy. The permission-policy tests validate scope and grant selection;
[live verification](research/deployment-bootstrap-verification.md) records provider
authorization separately.

Repeatable local check: `vp test run scripts/deployment-token-policy.test.ts`.
For live verification, apply bootstrap, run CI, confirm the generated token's
policy in Cloudflare, then reapply bootstrap and confirm its token ID is unchanged.
Record the CI run URL and outcome; a passing local test is not live rollout evidence.

## GitHub Actions secrets

### Repository configuration as code

`github.config.ts` owns repository metadata, merge settings, topics, labels,
the default-branch ruleset, Actions permissions, fork approvals, artifact/log
retention, and secret-scanning switches. The initial values preserve the existing
repository policy, including the `ci` and `e2e` required checks. Add further checks
to `branchRules` after their workflows have produced the exact check names.

Run the GitHub-only operator stack with a classic PAT carrying `repo` scope, or
a fine-grained token with repository Administration, Actions, Issues and
Variables write permissions. Selected secrets also require Secrets write.
It needs no Cloudflare credentials:

```sh
export BOOTSTRAP_GITHUB_REPOSITORY=your-owner/your-repository
pnpm run bootstrap:github:plan
pnpm run bootstrap:github
```

Authentication uses Alchemy's GitHub provider, including `gh` login or
`GITHUB_TOKEN`. The commands adopt matching resources and force reconciliation
of settings against the declared policy. Review the plan before applying it.
Only `--stage prod` is accepted, avoiding competing state for the same repository.
Keep `.alchemy` operator state protected and backed up. Repository/ruleset
removal retains the remote resources; removing Actions controls never resets
repository settings. Individual managed labels, variables and secrets follow
their native resource removal policies.

The deployment-access stack still owns production/preview environments and
deployment credentials under their existing logical IDs. The GitHub-only stack
publishes the repository privacy variables from `deployment.config.ts`. For an
operator-owned repository secret such as `CI_PAT`, add its name to
`repositorySecrets` in `github.config.ts` and supply that environment variable
when planning/applying. Values are redacted and never committed. Do not list
secrets already owned by deployment, backup, or monitoring stacks. GitHub cannot
read secret values back; adopting a secret requires its original value.

Workflow YAML, issue templates and the PR template remain ordinary versioned
files under `.github`. Installed apps and their service-owned webhooks retain
their own lifecycle. The repository owner is implicit GitHub access, not an
Alchemy collaborator resource. Backup and monitoring stacks own their separate
environments and enable gates.

The recommended path. The `deploy` job in
[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on pushes to `master` and manual `workflow_dispatch`, needs the `ci` and `e2e` jobs to pass first,
and reads its configuration from the `production`
[environment](https://docs.github.com/en/actions/reference/environments).
Bootstrap creates that environment and publishes the generated auth secret, account
ID, and configured provider secrets/variables. `CLOUDFLARE_API_TOKEN` is a repository
secret; do not also define it on the environment. The resulting inputs are:

| Secret                  | Required | Value                                               |
| ----------------------- | -------- | --------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | yes      | From step 2 above                                   |
| `CLOUDFLARE_ACCOUNT_ID` | yes      | From step 1 above                                   |
| `BETTER_AUTH_SECRET`    | yes      | Generated and persisted by bootstrap                |
| `ENVIRONMENT`           | no       | `production`, set by the workflow; no secret needed |

Configure `production.emailSending` in `deployment.config.ts` to manage email.
Bootstrap publishes its From address as the plain `CLOUDFLARE_EMAIL_FROM` variable;
a secret of that name no longer supplies the deploy input. After app deployment,
`pnpm run bootstrap:email` provisions the sender and lifecycle subscription using
an operator credential. See [email provisioning](email-delivery.md#cloudflare-setup)
for the account/zone-scoped permissions and command order.

Keep production values in the environment, not your local `.env`. The
`.env` file only needs local development defaults.

The workflow and Alchemy's `prod` stage set `ENVIRONMENT=production`, enabling
email verification and rejecting insecure auth secrets or URLs. Preserve that
value in customer deployments.

The deploy job forwards every optional provider variable
`packages/env/src/server.ts` lists, so activating a provider is a matter of
adding its value to the `production` environment — no workflow edit. Secret
keys come from environment **secrets**, plain keys from environment
**variables**, following that file's classification. An unset value resolves to
the empty string, which `alchemy.run.ts` drops from the worker env entirely, so
the provider stays inactive instead of half-configured. The
[provider guide](../apps/web/content/docs/getting-started/optional-providers.mdx)
explains activation, [operations setup](operations.md) the evidence endpoint,
and [retention](retention.md) the `RETENTION_*` values an approval artifact
prints.

Three names do not match their variable one-for-one:

| Worker variable        | Store it as                                 | Why                                                              |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `GITHUB_CLIENT_ID`     | variable `OAUTH_GITHUB_CLIENT_ID`           | GitHub rejects secret and variable names starting with `GITHUB_` |
| `GITHUB_CLIENT_SECRET` | secret `OAUTH_GITHUB_CLIENT_SECRET`         | Same restriction                                                 |
| `SERVICE_VERSION`      | variable `SERVICE_VERSION`, else the commit | Defaults to `github.sha` alongside `GIT_COMMIT_SHA`              |

`WORKSPACE_EXPORTS_ENABLED` is a deploy-time switch, not a bucket name: set the
variable to `true` and Alchemy provisions the export bucket and queue, named
per stage by `infra/bindings.ts` so no two stages share one bucket.

## Running a deploy

Dispatch CI from the CLI, using your repository and production branch:

```bash
gh workflow run ci.yml --repo <owner>/<repository> --ref master
```

Wait for `ci`, `e2e`, deployment, and the deployed-URL smoke checks.

### Release-aware smoke evidence

Production and preview run `.github/scripts/smoke-deployment.ts` against the
origins from the existing URL resolver. Preview checks out the PR head commit,
matching its deployment identity rather than stamping the synthetic merge commit
with a different SHA.

Every successful round requires HTTP 200 from API `/health` and the public web
homepage at `/`, which serves English directly with HTTP 200. The probe rejects
redirects, including the former `/en` locale redirect. These responses must expose `x-deployment-commit` matching
`GIT_COMMIT_SHA` and `x-deployment-version` matching `SERVICE_VERSION`. These
headers contain only the existing public deployment bindings, never credentials
or the full environment. Unset bindings remain optional for local development,
but missing identities cannot satisfy CI. Commits are lowercase 40-character
Git SHAs; version labels allow 1–128 letters, digits, underscores, dots, pluses
and hyphens. The probe responses use `Cache-Control: no-store`.

The API body is decoded with the same Effect schema as its health contract,
`{ "status": "ok" }`. The HTML must contain the homepage's `deployment-page`
marker and reference a same-origin `/assets/*.css` stylesheet. That stylesheet
must return nonempty CSS with HTTP 200. Login HTML, stale releases, missing
assets and unexpected redirects fail. This verifies public serving and release identity,
not database readiness or optional providers.

Requests, including body reads, time out after 10 seconds. A shared 90-second
propagation deadline bounds all rounds, with up to 3 seconds between rounds.
Only a complete successful round passes. Both workflows always upload
`artifacts/deployment-smoke.json`, retaining it for 14 days and failing upload
when it is absent. The artifact includes expected and observed identities,
start/completion and observation timestamps, each attempt, HTTP statuses and
`passed`, `failed` or `unknown` outcomes. Transport failures and missing identity
are unknown evidence; measured mismatches are failures. Neither passes. Earlier
failures remain in the artifact even when propagation eventually succeeds.
Raw response bodies and network exception messages are not retained.

Repeat against a deployment using its exact build inputs:

```sh
API_URL=https://your-api.example WEB_URL=https://your-web.example \
GIT_COMMIT_SHA=$(git rev-parse HEAD) SERVICE_VERSION=your-build-label \
node .github/scripts/smoke-deployment.ts
```

Run the local HTTP failure scenarios with
`vp test run .github/scripts/smoke-deployment.test.ts`. A failed smoke check
does not trigger a rollback, especially not a D1 migration reversal.

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
(Turnstile, Stripe, Cloudflare Web Analytics, OTLP, OpenAI, Workers AI, email)
and sets `ENVIRONMENT=preview`. A preview is publicly reachable and
signs in with the documented demo credentials, so never point one at
real data.

### Preview environment provisioning

Set `BOOTSTRAP_PREVIEW_ACCOUNT_ID` to a separate Cloudflare account and apply
bootstrap. The operator credential needs Account API Tokens Edit in that account
as well as production. Bootstrap rejects the production account ID: account-wide
API grants cannot be restricted by a `pr-` Worker name prefix.

Bootstrap creates a preview token with Workers Scripts, D1, and Secrets Store
Edit only. It generates a distinct preview auth secret and writes the same three
inputs into both `preview` and `preview-cleanup`. Neither environment requires
reviewers or a wait timer. `PREVIEW_ENABLED=true` is published at repository scope
only after all six secret writes complete. With no preview account configured,
bootstrap publishes `PREVIEW_ENABLED=false` and creates no preview credentials.

Destroy existing preview stages before removing preview configuration; otherwise
their cleanup credentials will be removed while those stages still exist.

The workflow reads these bootstrap-managed secrets from `preview`:

| Secret                          | Required | Value                                                                                          |
| ------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `PREVIEW_CLOUDFLARE_API_TOKEN`  | yes      | A token with only preview-stage permissions; it must not deploy or change production resources |
| `PREVIEW_CLOUDFLARE_ACCOUNT_ID` | yes      | From step 1 above                                                                              |
| `PREVIEW_BETTER_AUTH_SECRET`    | yes      | `openssl rand -base64 32`; shared by all preview stages, never the production value            |

The workflow resolves the account's `workers.dev` subdomain through the API.
`alchemy.run.ts` derives the auth origin from the stage's web Worker name, using
the same resolver as the workflow's smoke tests.

`preview-cleanup` receives the identical preview-only values. Its lack of required
reviewers lets closed pull requests destroy their stages without waiting for
approval. The same-repository and Dependabot checks in the workflow still apply.

### Running a preview stage from a laptop

The same scripts the workflow uses take the stage from `ALCHEMY_STAGE`
(or pass `--stage` to `alchemy` yourself):

```bash
export CLOUDFLARE_API_TOKEN=…
export CLOUDFLARE_ACCOUNT_ID=…
export CLOUDFLARE_WORKERS_SUBDOMAIN='your-subdomain'   # optional; otherwise discovered
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"

ALCHEMY_STAGE=pr-42 pnpm run deploy:stage     # provision + migrate
ALCHEMY_STAGE=pr-42 pnpm run db:seed:stage    # seed the Seed Workspace
ALCHEMY_STAGE=pr-42 pnpm run destroy:stage --confirm-target="$CLOUDFLARE_ACCOUNT_ID/pr-42"
```

Pick any stage name matching `[a-z0-9]+([-_][a-z0-9]+)*`; only names of
the form `pr-<number>` get the preview rules above (providers dropped,
URL derived). A stage such as `dev_martin` gets isolated resources but
otherwise uses its own workers.dev origin. Custom domains apply only to `prod`.

### Automatic tracing

Alchemy and the generated Wrangler configurations enable persistent native traces
at 100% sampling for all three Workers in every stage, including production.
Normal deployment applies the setting; no feature flag or tracing SDK is needed.
Logs, Issues, query-string redaction, and existing Effect exporters retain their
configuration. Native platform spans and Effect spans remain separate.

Inspect the deployed traces in the Cloudflare dashboard to verify binding spans
and captured attributes. Native telemetry bypasses the application sanitizer;
query-string redaction does not remove URL paths, SQL text, or exception messages.
See the [tracing assessment](research/cloudflare-effect-tracer.md).

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

Before customer use, complete [encryption verification](encryption.md) for the
deployed domains, bypass hostnames, provider connections, storage and key custody.
Repeat it after changes to those paths. HTTPS configuration alone does not prove
a TLS minimum or storage encryption.

Merging to `master` deploys after CI and E2E pass. The workflow also supports
manual dispatch. Adopters with customer data should protect the `production`
environment with required operator approval and disable automatic deployment
during incidents. Review schema changes before approving a deploy.

To rotate a managed provider secret, update its private `BOOTSTRAP_<name>` input,
apply bootstrap, and deploy again. For unmanaged secrets use `gh secret set <name>
--env production --repo <owner>/<repository>` with its private input prompt.
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

- `Invalid origin` on sign-in means the request uses a noncanonical hostname.
  Use the configured production domain (or the derived workers.dev URL when no
  domain is configured), and check `production.domains` before redeploying.
- Duplicate resource errors mean a resource with the same name already
  exists outside Alchemy's state store (created by hand or by another
  tool). Re-run with `--adopt` once to import it, then keep managing it
  through deploys.
- `Missing required deploy environment variable` means a required
  secret is missing from the `production` environment, or the job ran
  outside that environment.

## Private Assistant Conversation storage

Alchemy binds `ASSISTANT_CONVERSATIONS` to the SQLite conversation host exported
by the web Worker. API and background Workers address that host through
cross-Worker bindings within the same stage. Keep the named class export, SQLite
class migration and generated Wrangler declarations together when changing it.
PR stages isolate conversation objects alongside their D1 databases and queues.

Local development can persist D1 and conversation object state without remote
credentials. New generation requires an enabled Workers AI binding or configured
OpenAI-compatible provider. Set `ASSISTANT_RESOURCE_URL` separately from the MCP
resource, with `MCP_OAUTH_ISSUER` pointing to the web authorization server, to enable
member-authorized conversation REST. Workspace API Tokens have no access.

Before relying on a deployed stage, exercise disconnect before and during output,
reconnect from another owner tab and a REST observer, and deploy during an answer.
Recovery must preserve saved partial output and require explicit Retry, without
another automatic provider call. Verify the selected provider's streaming, usage
and cancellation behavior independently. These deployment checks are separate
from local domain and OAuth contract tests.

See the [conversation guide](../apps/web/content/docs/capability-interfaces/assistant-conversations.mdx)
for limits and the [recovery runbook](operations.md#private-assistant-conversation-recovery)
for storage boundaries and deletion sanitation.

## Browser analytics

Alchemy provisions Web Analytics automatically for the production stage.
Set `PRIVACY_CONTROLLER_NAME` and `PRIVACY_CONTACT_EMAIL`
as repository variables or deployment environment values. The privacy page uses
these to identify this deployment's controller; the browser token remains inactive
unless both are configured with a valid contact email.

The stack provisions `Cloudflare.Rum.Site` for
`new URL(BETTER_AUTH_URL).hostname` and binds its generated public site token only
to the web Worker as `CLOUDFLARE_WEB_ANALYTICS_TOKEN`. The auth URL and analytics
host are derived from the configured web domain or workers.dev origin. The production deploy credential needs
[`Account Settings Write`](https://developers.cloudflare.com/api/resources/rum/subresources/site_info/methods/create/)
to manage the account's RUM sites and explicit
[`Account Settings Read`](https://developers.cloudflare.com/api/resources/rum/subresources/site_info/methods/list/)
for discovery during planning.

Alchemy sets `autoInstall: false`; the app embeds the beacon itself. Do not add a
dashboard-injected copy. PR stages skip both provisioning and token binding.
Local development stays inactive without a token.

After deployment, verify no vendor requests
before consent or after decline, then allow analytics and check that one beacon
script loads and measurements appear after navigation on the deployed hostname.
Use Analytics settings to withdraw consent and verify reporting stops, including
in another open tab. A consent change reloads the page. Choices expire after 180
days. Check that a deployment without a token or controller makes no requests.
The [integration guide](../apps/web/content/docs/integrations/cloudflare-observability.mdx)
describes collected data and the privacy review needed before enabling analytics.
