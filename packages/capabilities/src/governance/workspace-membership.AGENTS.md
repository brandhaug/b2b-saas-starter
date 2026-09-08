# Workspace membership

Membership reads use Drizzle; writes use `WorkspaceMemberBinding`. Identity types belong to `workspace-identity.ts`. Joining is invitation-only or SSO in the UI; retain `addMember` for programmatic/admin use.

- Binding calls address a member row ID plus workspace ID, except `addMember`, which takes a user ID, and `leave`, which resolves the actor from session headers. Do not implement leave through removal: ordinary members can leave without `member:delete`.
- `refuseMembershipChange` mirrors plugin ownership invariants in both adapters. Sole-owner protection and owner-role assignment restrictions remain separate from boundary permission checks.
- Membership refusal is `MembershipChangeRejected`; missing bindings or unreachable storage are `CapabilityUnavailable`. Keep refusals out of retry paths.
- Additions, removals, and leaving publish best-effort seat synchronization. Role changes do not change seat quantity. Every successful mutation retains its audit; leaving records reason `left`.
- `layers.ts` shares one `SeedRoster` across membership, invitations, and account lifecycle. Separate stores make invitation acceptance and account deletion disagree with roster reads.
- `listMembers` inner-joins users. A deleted user therefore disappears; a future tombstone display requires a left join.
- Contract refusal cases must leave the runner's actor a member. Test successful leaving in adapter-specific suites.
- Stored role changes belong in `db/enums`, the migration, and Better Auth configuration together.
