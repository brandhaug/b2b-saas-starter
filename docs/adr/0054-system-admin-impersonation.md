# System admin impersonation

System admins can open a one-hour Better Auth session as a non-admin user. It carries the target's permissions, a persistent stop banner, audited start/stop actions, and a notification to the target when impersonation starts. Self-impersonation and admin targets are refused.

The auth boundary blocks credential, second-factor, email, passkey, and account-deletion changes during impersonation. UI hiding mirrors those refusals but does not enforce them. These restrictions prevent an admin from leaving a persistent credential behind. Plugin session changes and audits have the same non-atomicity as [membership writes](./0051-workspace-membership-on-better-auth-organization-plugin.md).
