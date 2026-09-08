# Passkeys through Better Auth

Better Auth's passkey plugin owns WebAuthn ceremonies and credential storage. The relying-party hostname and origin derive from the auth URL to avoid independent configuration drift. The app owns credential-change audits, account-holder notifications, and impersonation restrictions.

Passkey sign-in opens a session without a separate TOTP challenge, including for TOTP-enabled users. Authenticator user verification is preferred rather than required, so this configuration does not guarantee two factors for every passkey ceremony. Registration requires an existing session; passkey-first account creation remains out of scope.
