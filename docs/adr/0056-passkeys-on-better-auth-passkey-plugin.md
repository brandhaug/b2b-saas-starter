# Passkeys through Better Auth

Better Auth's passkey plugin owns WebAuthn ceremonies and credential storage. The relying-party hostname and origin derive from the auth URL to avoid independent configuration drift. The app owns credential-change audits, account-holder notifications, and impersonation restrictions.

Passkey sign-in opens a session without a separate TOTP challenge, including for TOTP-enabled users. Authenticator user verification is preferred rather than required, so this configuration does not guarantee two factors for every passkey ceremony. Registration requires an existing session; passkey-first account creation remains out of scope.

Privileged access additionally requires the verified authentication response to confirm user verification. Non-verifying passkeys can sign in but do not qualify for System Admin or Workspace owner/admin access. Proof binds the issued session to the current credential; registration alone grants no privileged proof. See [privileged authentication](../strong-authentication.md).
