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

**Integration Surface**:
A real extension point for connecting external providers without requiring those providers for local development.
_Avoid_: Placeholder, mock integration, mandatory provider

**Workspace**:
A team-owned area where users configure and evaluate their use of the starter.
_Avoid_: Account, organization, tenant

**Starter Module**:
A reusable capability included in the starter, such as auth, email, REST API, MCP, billing, catalog updates, or integrations.
_Avoid_: Feature, plugin, package

**Module State**:
The enablement and configuration state of a starter module within a workspace.
_Avoid_: Feature flag, readiness score

**Adoption Readiness**:
The visible state of how completely a workspace has configured and understood the starter modules it plans to use.
_Avoid_: Health score, setup progress

**Cloudflare-First**:
The starter's deployment and persistence model is designed around Cloudflare Workers, D1, and related platform services.
_Avoid_: Multi-cloud, platform-agnostic

**Implementation Report**:
A workspace-facing summary of starter module configuration, readiness, and operational status.
_Avoid_: Developer productivity report, DORA report

**Report Schedule**:
A workspace setting that controls recurring implementation report generation and delivery.
_Avoid_: Cron job, email schedule

**Local Auth Path**:
The email-and-password sign-in path that works without external provider configuration.
_Avoid_: Fallback auth, demo auth

**Example OAuth Provider**:
The OAuth provider included to demonstrate production OAuth setup without implying every provider is configured.
_Avoid_: Required OAuth provider, placeholder provider

**Optional Provider Module**:
A starter module that has production wiring but remains inactive until its required external provider configuration exists.
_Avoid_: Stub, fake module, required service

**Capability Interface**:
An external interface that exposes starter capabilities without owning separate business behavior.
_Avoid_: Separate API domain, duplicate service

**Catalog Refresh**:
A recurring operation that updates starter module metadata and dependency catalog information.
_Avoid_: One-off script, manual maintenance task

**Public Knowledge Content**:
Versioned MDX content that explains the starter, its modules, and its technology choices.
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
A recorded security, admin, workspace, billing, integration, API, or catalog action.
_Avoid_: Log line, activity item, notification

**Notification**:
A user-facing message about workspace, module, report, billing, integration, or API token activity.
_Avoid_: Audit event, log line, email

**API Token**:
A workspace-scoped credential for REST and MCP access.
_Avoid_: Personal access token, integration secret, session token

**Webhook Endpoint**:
A workspace-owned outbound event delivery target.
_Avoid_: Provider webhook, callback URL, integration

**Seed Workspace**:
A deterministic workspace included for local development, tests, and showcase screenshots.
_Avoid_: Fake account, sample tenant

## Relationships

- A **Starter** includes exactly one **Reference Application**
- A **Reference Application** proves the reusable patterns promoted by the **Showcase Site**
- A **Showcase Site** describes the **Starter**, not a fictional SaaS product
- A **Reference Application** exposes **Integration Surfaces** that become active when provider configuration exists
- A **Workspace** tracks one or more **Starter Modules**
- A **Starter Module** has one **Module State** per **Workspace**
- **Adoption Readiness** belongs to a **Workspace** and is derived from its **Starter Modules**
- The **Starter** is **Cloudflare-First**
- An **Implementation Report** summarizes **Adoption Readiness** for a **Workspace**
- A **Report Schedule** can produce recurring **Implementation Reports** for a **Workspace**
- The **Reference Application** supports a **Local Auth Path** and one or more **Example OAuth Providers**
- Billing is an **Optional Provider Module**
- REST and MCP are **Capability Interfaces** over the same workspace and starter module behavior
- A **Catalog Refresh** can run from production background infrastructure or from CI automation
- **Public Knowledge Content** is searched from generated indexes, while **Workspace** state comes from D1-backed capabilities
- A changelog is **Public Knowledge Content** for release notes, upgrade notes, and catalog changes
- A **Workspace** has one or more **Members**
- An **Invitation** targets one **Workspace Role** in one **Workspace**
- A **Member** has exactly one **Workspace Role** per **Workspace**
- A **System Admin** manages users globally and is distinct from a **Workspace Role**
- An **Audit Event** can be associated with a user, workspace, system admin action, or provider action
- A **Notification** can be created from workspace, module, report, billing, integration, or API token activity
- An **API Token** belongs to exactly one **Workspace** and can create **Audit Events**
- A **Webhook Endpoint** belongs to exactly one **Workspace** and receives selected outbound events
- A **Seed Workspace** demonstrates **Starter Modules**, **Adoption Readiness**, **Members**, **Integration Surfaces**, and **Implementation Reports**

## Example Dialogue

> **Dev:** "Should the landing page sell a made-up analytics product?"
> **Domain expert:** "No. The **Showcase Site** should explain why this **Starter** is a strong foundation, and the **Reference Application** should prove those claims with working SaaS features."
>
> **Dev:** "Should GitHub or Slack setup be required before the app boots?"
> **Domain expert:** "No. Those are **Integration Surfaces**: the routes, models, settings, and OAuth flow should exist, but local development should work before provider secrets are configured."
>
> **Dev:** "What does a user do after creating a workspace?"
> **Domain expert:** "They review their **Starter Modules**, configure the ones they need, and use **Adoption Readiness** to understand what remains."
>
> **Dev:** "Can readiness be edited directly?"
> **Domain expert:** "No. **Adoption Readiness** is derived from each **Starter Module** and its **Module State**."
>
> **Dev:** "Should we document deployment paths for Vercel, Node servers, and Postgres?"
> **Domain expert:** "No. The **Starter** is **Cloudflare-First**, so the production path should stay coherent around Workers, D1, Alchemy, and Wrangler."
>
> **Dev:** "Can we keep Contributor's dashboard and reports?"
> **Domain expert:** "Yes, but only as interaction patterns. In this context they become adoption overviews and **Implementation Reports**, not developer productivity analytics."
>
> **Dev:** "Are implementation reports only generated manually?"
> **Domain expert:** "No. A **Workspace** can generate reports manually and define a **Report Schedule** for recurring delivery."
>
> **Dev:** "Should OAuth be required for local development?"
> **Domain expert:** "No. The **Local Auth Path** must work by default, and GitHub can be the first **Example OAuth Provider** when secrets are configured."
>
> **Dev:** "Should Stripe be required before someone can try the starter?"
> **Domain expert:** "No. Billing should be an **Optional Provider Module** with real checkout, portal, webhook, and settings surfaces that activate when Stripe configuration exists."
>
> **Dev:** "Should Sentry and PostHog be part of the starter?"
> **Domain expert:** "Yes. They should be **Optional Provider Modules** with env-gated initialization so local development does not require either service."
>
> **Dev:** "Should the REST API and MCP server demonstrate different domains?"
> **Domain expert:** "No. They should be **Capability Interfaces** over the same workspace, starter module, readiness, and integration behavior."
>
> **Dev:** "Is catalog updating just a local maintenance command?"
> **Domain expert:** "No. A **Catalog Refresh** should be represented as recurring operational work, with production background infrastructure and CI automation where appropriate."
>
> **Dev:** "Should docs and blog posts live in the database?"
> **Domain expert:** "No. **Public Knowledge Content** is checked-in MDX with generated search, while workspace-specific readiness and settings come from D1."
>
> **Dev:** "Where do release notes and dependency catalog changes belong?"
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
> **Dev:** "Should catalog refresh failures only show up in logs?"
> **Domain expert:** "No. They can create **Notifications** for users and **Audit Events** when governance-sensitive."
>
> **Dev:** "Should REST and MCP only use browser sessions?"
> **Domain expert:** "No. External clients should use workspace-scoped **API Tokens** with scopes and revocation."
>
> **Dev:** "Are billing webhooks and customer webhooks the same thing?"
> **Domain expert:** "No. Provider callbacks are integration-specific routes, while a **Webhook Endpoint** is a workspace-owned outbound event target."
>
> **Dev:** "Should the app start empty after local setup?"
> **Domain expert:** "No. It should include a **Seed Workspace** so the reference app, tests, and screenshots have stable starter data."

## Flagged Ambiguities

- "B2B SaaS Starter" could mean either a product template or a fictional SaaS app. Resolved: it is a **Starter**, and the included SaaS experience is a **Reference Application**.
- "Integration" could mean a fake placeholder or a mandatory configured provider. Resolved: it means an **Integration Surface** that is real in structure and opt-in at runtime.
- "Feature" is too generic for this repository's core units. Resolved: reusable SaaS capabilities are **Starter Modules**.
- "Feature flag" is too broad for the starter's module workflow. Resolved: per-workspace configuration is **Module State**.
- "Cloudflare support" understates the platform decision. Resolved: the starter is **Cloudflare-First**, not platform-agnostic.
- Contributor's analytics terms should not become this repo's domain language. Resolved: copy UX patterns, but express them through **Starter Modules**, **Adoption Readiness**, and **Implementation Reports**.
- "Report schedule" is a workspace setting, not just infrastructure cron. Resolved: use **Report Schedule**.
- "OAuth support" should not make local setup dependent on GitHub or any other provider. Resolved: email/password is the **Local Auth Path**, and GitHub OAuth is an **Example OAuth Provider**.
- "Billing included" means billing is an **Optional Provider Module**, not that Stripe setup is mandatory for local development.
- Sentry and PostHog are included but should not become required setup steps. Resolved: both are **Optional Provider Modules**.
- REST and MCP should not drift into separate demos. Resolved: both are **Capability Interfaces** for the same underlying behavior.
- "Catalog updater" should not mean only a developer-run script. Resolved: **Catalog Refresh** covers both runtime background work and dependency catalog automation.
- Public docs, FAQ, help, and blog content should not be modeled as workspace data. Resolved: they are **Public Knowledge Content**.
- "Team", "seat", and "collaborator" should not compete with the workspace model. Resolved: use **Member**, **Invitation**, and **Workspace Role**.
- "Admin" is ambiguous. Resolved: use **System Admin** for global Better Auth admin users and **Workspace Role** for workspace-level permissions.
- "Audit log" should not be confused with operational logs. Resolved: persisted governance records are **Audit Events**.
- "Notification" should not be used for persisted governance history. Resolved: **Notifications** are user-facing messages, while **Audit Events** are inspectable governance records.
- REST and MCP credentials should not be modeled as user sessions or provider secrets. Resolved: use workspace-scoped **API Tokens**.
- "Webhook" is ambiguous. Resolved: use **Webhook Endpoint** for outbound workspace event delivery; provider callbacks are integration routes.
- "Demo data" should be deterministic and part of the reference app's local experience. Resolved: use a **Seed Workspace**.
