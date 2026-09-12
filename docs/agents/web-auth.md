# Web auth request handling

Implementation guidance for `apps/web`. Auth handler modules live in `apps/web/src/lib/server`; route and component paths are relative to `apps/web/src`. Read this when changing auth HTTP handling, session reads, workspace authentication gates, anonymous credential flows, or their rate limits.

- The Better Auth HTTP handler shares one `AuthExchange` URL parse and session read. `auth-request-guard.ts` owns classification, pre-handler context and guard order — impersonation (the specific refusal, so it wins over the generic one), strong authentication, then the two SSO sign-in refusals; a failed session read is a 503, never an anonymous request. Refusals skip the plugin and all post-handler processing, and answer through `auth-refusal.ts`. Rate limiting and Turnstile run first; two-factor enforcement, audit, notifications and evidence run only after a handled plugin response.

- `auth-session-read.ts` owns the one session read: `server/auth.ts`'s gates and the catchall's guards share the request's `auth.session` memo slot; the two-factor gate reads a minted cookie unmemoized.

- The `routes/workspaces.$workspaceSlug.tsx` `beforeLoad` reads one gate payload (suspension state plus `strongAuthenticationRequired`) and redirects: suspended workspaces to `/suspended`, unverified owners and admins to `/verify-authentication?redirect=…`. The authentication gate is subtree-wide by choice, wider than `authorize.ts`, where only `requireWorkspacePermission` hard-gates and dashboard segments take the soft `whenPermitted` path: an owner or admin whose strong-auth window lapsed verifies once at the boundary instead of meeting the gate halfway through a page. Members are never asked — `needsStrongAuthentication` names only owners, admins and system admins. `/suspended` is exempt, since it maps to the `credential_recovery` operation. The evidence read joins `strongAuthenticationStatusFor`'s per-request memo slot, so the gate costs no extra round trip.

- Turnstile gates every anonymous mail-an-address POST (sign-up, magic link, one-time code, password reset, verification email); each gated path has a widget on the screen that drives it through `useTurnstileChallenge`, and the token rides `x-turnstile-token` from a port in `components/auth/auth-client-ports.ts`. With TURNSTILE unset the site key is `null`, no widget renders and the gate answers `inactive` (ADR 0031).

- `lib/rate-limit.ts` trusts only `cf-connecting-ip`; email-OTP, magic-link and reset sends, the second-factor checks, and the session-free SSO routing server fn share sign-in's `auth_sign_in` bucket (ADR 0030).

- Non-disclosure is a rule: constant responses on `/forgot-password`, `disableSignUp` on email-OTP, one opaque failure on `/invitations/accept` and link landings.
