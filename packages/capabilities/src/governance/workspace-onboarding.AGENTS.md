# Workspace onboarding

The checklist is the live `workspaceProgress` projection in `../workspace-projections.ts`. Only dismissal is persisted; revoked or removed resources must undo their derived steps.

- Read the actor's two-factor state through this capability so every interface projects the same answer. An actorless context returns false. Move this account-level read if another capability needs it.
- Dismissal batches its write and audit, returning false without writing when already dismissed. The caller checks `onboarding:dismiss`.
- `workspaces.onboardingDismissedAt` intentionally has no organization-plugin `additionalFields` entry: plugin responses never carry it. Preserve the plugin table's epoch storage and ISO projection.
- Seed keeps dismissal state per layer and receives `seedTwoFactorUserIds` through `layers.ts`, so the demo owner's unfinished step matches Live.
