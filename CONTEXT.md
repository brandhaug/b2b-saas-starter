# B2B SaaS Starter

The Starter is the repository product. Its Reference Application demonstrates workspace behavior; its Showcase Site explains the repository.

## Language

**Plan**:
A named set of Workspace entitlements and billing terms.
_Avoid_: Workspace Role, access tier

**Onboarding Checklist**:
A Workspace's suggested setup steps, derived from its current state and the viewing Member's account.
_Avoid_: Tutorial progress, setup wizard

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

**Local Auth Path**:
A sign-in method available without configuring an external identity provider, including password, magic link, email one-time code, and passkey sign-in.
_Avoid_: Fallback auth, demo auth

**Optional Provider**:
A capability with production wiring that remains inactive until its required external provider configuration exists.
_Avoid_: Stub, fake provider, required service

**Linked Provider**:
An external sign-in identity attached to an existing account, such as a GitHub or Google login.
_Avoid_: Connection, integration, social login account

**Capability Interface**:
An external interface that exposes starter capabilities without owning separate business behavior.
_Avoid_: Separate API domain, duplicate service

**Public Knowledge Content**:
Versioned documentation, blog posts, and release notes about the Starter.
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
A user with global user-management permissions, independent of their Workspace Roles.
_Avoid_: Workspace owner, workspace admin, operator

**Audit Event**:
A recorded security, admin, workspace, billing, or API action.
_Avoid_: Log line, activity item, notification

**Notification**:
A user-facing message about workspace, billing, or API token activity.
_Avoid_: Audit event, log line, email

**Seat Quantity**:
The number of Members billed for one Workspace on a per-seat Plan.
_Avoid_: User limit, license, headcount cap

**Billing Portal**:
The provider-hosted page for invoices, payment methods, and subscription cancellation.
_Avoid_: Billing settings, payment page

**Billing Synchronization**:
Reconciliation of a Workspace's recorded subscription and Seat Quantity with the billing provider and current membership.
_Avoid_: Payment approval, entitlement grant, webhook replay

**Subscribed Plan**:
The Plan named by the verified provider subscription, retained even while access falls back to Starter.
_Avoid_: Effective Plan, displayed plan

**Effective Plan**:
The Plan whose entitlements apply now, based on verified payment, trial, and Renewal Grace. It falls back to Starter when paid access ends.
_Avoid_: Subscribed Plan, catalog plan

**Renewal Grace**:
The fixed seven-day access period after a previously paying subscription first fails renewal. Retries do not extend it; unpaid or canceled subscriptions end it sooner.
_Avoid_: Trial, payment retry window

**Resource Selection**:
An owner/admin choice of the API Tokens and Webhook Endpoints that remain active when their category exceeds Starter's limit. The choice pauses excess resources without deleting them.
_Avoid_: Resource deletion, seat selection

**API Token**:
A workspace-scoped credential for REST and MCP access.
_Avoid_: Personal access token, integration secret, session token

**MCP Client**:
An interactive AI client connected by a Member to one Workspace through OAuth consent, acting with that Member's permissions.
_Avoid_: Integration, OAuth app, connected account

**Webhook Endpoint**:
A workspace-owned outbound event delivery target.
_Avoid_: Provider webhook, callback URL, integration

**Webhook Delivery**:
One event payload addressed to one Webhook Endpoint, including its automatic
retries. A manual replay is a new delivery linked to its source.
_Avoid_: Attempt, callback

**Webhook Attempt**:
An individual dispatch result or terminal outcome within a Webhook Delivery.
_Avoid_: Delivery, audit event

**Seed Workspace**:
A deterministic workspace included for local development, tests, and showcase screenshots.
_Avoid_: Fake account, sample tenant

**Impersonation Session**:
A temporary session a System Admin opens as another user, with that user's permissions and restrictions on credential changes.
_Avoid_: Login as, sudo mode, admin takeover

**Account Deletion**:
Self-service removal of a user account. Sole ownership of a shared Workspace blocks deletion until ownership transfers.
_Avoid_: Account cancellation, GDPR wipe, user removal

**Workspace Export**:
An owner-requested archive of a Workspace's application data, excluding secrets.
_Avoid_: Backup, data dump, GDPR export

**Notification Kind**:
The subject of a Notification, used to select its email template and Notification Preference.
_Avoid_: Notification type, event type, category

**Notification Preference**:
A user's per-kind choice of email channel: off, instant, or digest. Belongs to the user, not to a workspace.
_Avoid_: Subscription, opt-in, alert setting

**Notification Digest**:
A daily email grouping unread Notifications selected by a user's digest preferences.
_Avoid_: Summary email, newsletter, batch

**SSO Connection**:
A workspace-owned single sign-on configuration (SAML or OIDC) that routes one email domain to an identity provider.
_Avoid_: IdP config, tenant SSO, integration
**Domain Routing**:
The sign-in rule that an email whose domain matches an enabled SSO Connection goes to that connection's identity provider.
_Avoid_: Email fallback, forced SSO, redirect matching
