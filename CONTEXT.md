# B2B SaaS Starter

B2B SaaS Starter is a repository product that showcases a production-grade full-stack SaaS foundation. Its included application is a reference implementation that demonstrates the starter's architecture and feature set.

## Language

**Starter**:
A reusable repository foundation for building B2B SaaS products.
_Avoid_: Template, boilerplate

**Reference Application**:
The working SaaS app included in the starter to demonstrate real product patterns.
_Avoid_: Demo app, fictional product

**Showcase Site**:
The public-facing pages that explain the starter, its architecture, and its technology choices.
_Avoid_: Marketing site for a fake SaaS

**Workspace**:
A team-owned area where users collaborate and use the reference application's capabilities.
_Avoid_: Account, organization, tenant

**Cloudflare-First**:
The starter's deployment and persistence model is designed around Cloudflare Workers, D1, and related platform services.
_Avoid_: Multi-cloud, platform-agnostic

**Local Auth Path**:
The email-and-password sign-in path that works without external provider configuration.
_Avoid_: Fallback auth, demo auth

**Passkey**:
A WebAuthn credential registered to a user's account for phishing-resistant passwordless sign-in.
_Avoid_: WebAuthn key, biometric login, security key login

**Optional Provider**:
A capability with production wiring that remains inactive until its required external provider configuration exists.
_Avoid_: Stub, fake provider, required service

**Capability Interface**:
An external interface that exposes starter capabilities without owning separate business behavior.
_Avoid_: Separate API domain, duplicate service

**Public Knowledge Content**:
Versioned MDX content that explains the starter and its technology choices.
_Avoid_: CMS content, database-backed docs

**Member**:
A user who belongs to a workspace with a role.
_Avoid_: Seat, teammate, collaborator

**Invitation**:
A request for a user to join a workspace with a specific role.
_Avoid_: Invite link, onboarding email

**Workspace Role**:
The permission level a member has within a workspace: owner, admin, or member.
_Avoid_: Permission group, access tier

**System Admin**:
A user with global user-management permissions through Better Auth's admin plugin.
_Avoid_: Workspace owner, workspace admin, operator

**Audit Event**:
A recorded security, admin, workspace, billing, or API action.
_Avoid_: Log line, activity item, notification

**Notification**:
A user-facing message about workspace, billing, or API token activity.
_Avoid_: Audit event, log line, email

**Seat Quantity**:
The number of Members a per-seat plan bills for one Workspace, mirrored onto the Stripe subscription item's quantity.
_Avoid_: User limit, license, headcount cap

**Billing Portal**:
The Stripe-hosted surface where a Workspace's invoices, payment method, and cancellation are managed.
_Avoid_: Billing settings, payment page

**API Token**:
A workspace-scoped credential for REST and MCP access.
_Avoid_: Personal access token, integration secret, session token

**Webhook Endpoint**:
A workspace-owned outbound event delivery target.
_Avoid_: Provider webhook, callback URL, integration

**Seed Workspace**:
A deterministic workspace included for local development, tests, and showcase screenshots.
_Avoid_: Fake account, sample tenant

**Onboarding Checklist**:
The workspace dashboard's list of setup steps, each derived from live capability state on every read and never stored as a flag; owners and admins can dismiss it for the workspace.
_Avoid_: Setup wizard, progress tracker, getting-started flags

**Preview Stage**:
An ephemeral, fully isolated deployment of the starter (`pr-<number>`) created for one pull request and destroyed when it closes; it carries the Seed Workspace and no optional providers.
_Avoid_: Staging, preview environment, branch deploy

**Impersonation Session**:
A one-hour session a System Admin opens as another user through Better Auth's admin plugin, audited at start and stop, visible in the app shell, and barred from changing the account's credentials.
_Avoid_: Login as, sudo mode, admin takeover

**Workspace Export**:
An owner-requested ZIP of a workspace's members, invitations, API Token metadata, Webhook Endpoints, Audit Events, Notifications, and settings, built in the background and downloaded through a signed, time-limited link.
_Avoid_: Backup, data dump, GDPR export

**Page**:
One bounded slice of a list read, returned as `items` plus an opaque `nextCursor` that is `null` on the last page.
_Avoid_: Offset, page number, batch

**Cursor**:
An opaque keyset position (sort key plus id) a client hands back to continue a list read from where the previous Page ended.
_Avoid_: Offset, skip, page token

**Typed SDK**:
The `@b2b-saas-starter/sdk` client derived from the REST contract, so a caller gets the same paths, schemas, and errors the API Worker serves.
_Avoid_: Generated client, OpenAPI codegen, wrapper library

## Relationships

- A **Starter** includes exactly one **Reference Application**
- A **Reference Application** proves the reusable patterns promoted by the **Showcase Site**
- A **Showcase Site** describes the **Starter**, not a fictional SaaS product
- A **Reference Application** keeps optional providers env-gated: local development works with no provider configuration
- The **Starter** is **Cloudflare-First**
- The **Reference Application** supports a **Local Auth Path**
- A **Passkey** belongs to exactly one user account and satisfies the two-factor requirement at sign-in
- Billing is an **Optional Provider**
- REST and MCP are **Capability Interfaces** over the same workspace behavior
- **Public Knowledge Content** is searched from generated indexes, while **Workspace** state comes from D1-backed capabilities
- A changelog is **Public Knowledge Content** for release notes and upgrade notes
- A **Workspace** has one or more **Members**
- An **Invitation** targets one **Workspace Role** in one **Workspace**
- A **Member** has exactly one **Workspace Role** per **Workspace**
- A **System Admin** manages users globally and is distinct from a **Workspace Role**
- An **Audit Event** can be associated with a user, workspace, system admin action, or provider action
- A **Notification** can be created from workspace, billing, or API token activity
- A **Workspace** on a per-seat plan bills one **Seat Quantity** per **Member**
- Invoices, payment methods, and cancellation are managed in the **Billing Portal**, not in the Reference Application
- An **API Token** belongs to exactly one **Workspace** and can create **Audit Events**
- A **Webhook Endpoint** belongs to exactly one **Workspace** and receives selected outbound events
- A **Seed Workspace** demonstrates **Members**, **Notifications**, and the developer-platform capabilities
- An **Onboarding Checklist** derives its steps from **Members**, **API Tokens**, **Webhook Endpoints**, billing, and the actor's account; dismissing it records an **Audit Event**
- An **Impersonation Session** is opened by a **System Admin**, records two **Audit Events**, and creates a **Notification** for the impersonated user
- A **Workspace Export** belongs to exactly one **Workspace**, is requested by an owner, and creates **Audit Events** and a **Notification**
- A **Workspace Export** is the access half of a data subject request; account deletion is the erasure half
- Every REST and MCP list read returns a **Page** and accepts a **Cursor**; REST and MCP page the same way because both are **Capability Interfaces** over one operation table
- The **Typed SDK** authenticates with an **API Token** and walks **Pages** for the caller

## Example Dialogue

> **Dev:** "Should the landing page sell a made-up analytics product?"
> **Domain expert:** "No. The **Showcase Site** should explain why this **Starter** is a strong foundation, and the **Reference Application** should prove those claims with working SaaS features."
>
> **Dev:** "Should provider setup be required before the app boots?"
> **Domain expert:** "No. Optional providers are env-gated **Optional Providers**: local development should work before provider secrets are configured."
>
> **Dev:** "What does a user do after creating a workspace?"
> **Domain expert:** "They invite their team, and the **Workspace**'s capabilities — notifications, API tokens, webhooks, audit events — are ready to use."
>
> **Dev:** "Should we document deployment paths for Vercel, Node servers, and Postgres?"
> **Domain expert:** "No. The **Starter** is **Cloudflare-First**, so the production path should stay coherent around Workers, D1, Alchemy, and Wrangler."
>
> **Dev:** "Can we keep Contributor's dashboard patterns?"
> **Domain expert:** "Yes, but only as interaction patterns. In this context they present workspace state, not developer productivity analytics."
>
> **Dev:** "Should OAuth be required for local development?"
> **Domain expert:** "No. The **Local Auth Path** must work by default — email/password sign-in works with no provider secrets configured."
>
> **Dev:** "Should Stripe be required before someone can try the starter?"
> **Domain expert:** "No. Billing should be an **Optional Provider** whose surfaces activate when Stripe configuration exists."
>
> **Dev:** "Should Sentry and PostHog be part of the starter?"
> **Domain expert:** "Yes. They should be **Optional Providers** with env-gated initialization so local development does not require either service."
>
> **Dev:** "Should the REST API and MCP server demonstrate different domains?"
> **Domain expert:** "No. They should be **Capability Interfaces** over the same workspace behavior."
>
> **Dev:** "Should docs and blog posts live in the database?"
> **Domain expert:** "No. **Public Knowledge Content** is checked-in MDX with generated search, while workspace-specific state comes from D1."
>
> **Dev:** "Where do release notes belong?"
> **Domain expert:** "In a changelog as **Public Knowledge Content**, not as workspace data."
>
> **Dev:** "Can workspaces be single-user until later?"
> **Domain expert:** "No. A B2B **Workspace** needs **Members**, **Invitations**, and simple **Workspace Roles** from the start."
>
> **Dev:** "Is a workspace owner the same as a global admin?"
> **Domain expert:** "No. A **Workspace Role** controls access within one workspace, while a **System Admin** manages users globally through Better Auth admin capabilities."
>
> **Dev:** "Are admin changes just normal logs?"
> **Domain expert:** "No. Security-sensitive and governance actions should create **Audit Events** that can be inspected in the app."
>
> **Dev:** "Should REST and MCP only use browser sessions?"
> **Domain expert:** "No. External clients should use workspace-scoped **API Tokens** with scopes and revocation."
>
> **Dev:** "Are billing webhooks and customer webhooks the same thing?"
> **Domain expert:** "No. Provider callbacks are integration-specific routes, while a **Webhook Endpoint** is a workspace-owned outbound event target."
>
> **Dev:** "Is a workspace export the same thing as a backup?"
> **Domain expert:** "No. A **Workspace Export** is what an owner takes with them or hands to a data subject: the projections the app shows, never secrets, built once and kept for seven days. A backup is an operator's concern."
>
> **Dev:** "Should the app start empty after local setup?"
> **Domain expert:** "No. It should include a **Seed Workspace** so the reference app, tests, and screenshots have stable starter data."

## Flagged Ambiguities

- "B2B SaaS Starter" could mean either a product template or a fictional SaaS app. Resolved: it is a **Starter**, and the included SaaS experience is a **Reference Application**.
- "Integration" could mean a fake placeholder or a mandatory configured provider. Resolved: optional providers are **Optional Providers** that are real in structure and opt-in at runtime.
- "Feature" is too generic for this repository's vocabulary. Resolved: reusable SaaS capabilities are named for what they are (workspaces, webhooks, notifications), not lumped as features.
- "Cloudflare support" understates the platform decision. Resolved: the starter is **Cloudflare-First**, not platform-agnostic.
- Contributor's analytics terms should not become this repo's domain language. Resolved: copy UX patterns, but express workspace data through its own capabilities.
- "OAuth support" should not make local setup dependent on GitHub or any other provider. Resolved: email/password is the **Local Auth Path**.
- "Billing included" means billing is an **Optional Provider**, not that Stripe setup is mandatory for local development.
- Sentry and PostHog are included but should not become required setup steps. Resolved: both are **Optional Providers**.
- REST and MCP should not drift into separate demos. Resolved: both are **Capability Interfaces** for the same underlying behavior.
- Public docs, FAQ, help, and blog content should not be modeled as workspace data. Resolved: they are **Public Knowledge Content**.
- "Team", "seat", and "collaborator" should not compete with the workspace model. Resolved: use **Member**, **Invitation**, and **Workspace Role**. Billing still needs the word, so **Seat Quantity** names what the provider bills — a number, never a person.
- "Admin" is ambiguous. Resolved: use **System Admin** for global Better Auth admin users and **Workspace Role** for workspace-level permissions.
- "Audit log" should not be confused with operational logs. Resolved: persisted governance records are **Audit Events**.
- "Notification" should not be used for persisted governance history. Resolved: **Notifications** are user-facing messages, while **Audit Events** are inspectable governance records.
- REST and MCP credentials should not be modeled as user sessions or provider secrets. Resolved: use workspace-scoped **API Tokens**.
- "Webhook" is ambiguous. Resolved: use **Webhook Endpoint** for outbound workspace event delivery; provider callbacks are integration-specific routes.
- "Demo data" should be deterministic and part of the reference app's local experience. Resolved: use a **Seed Workspace**.
- "Export" could mean a database backup or a GDPR-specific artifact. Resolved: a **Workspace Export** is an owner-facing ZIP of the workspace's own projections; GDPR requests are served with it plus account deletion, not by a separate export.
