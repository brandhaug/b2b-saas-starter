# Web auth request handling

Implementation guidance for `apps/web`. Auth handler modules live in `apps/web/src/lib/server`; route and component paths are relative to `apps/web/src`. Read this when changing auth HTTP handling, session reads, workspace authentication gates, anonymous credential flows, or their rate limits.

- The Better Auth HTTP handler shares one `AuthExchange` URL parse and session read. `auth-request-guard.ts` owns classification, pre-handler context and guard order — impersonation (the specific refusal, so it wins over the generic one), strong authentication, then the two SSO sign-in refusals; a failed session read is a 503, never an anonymous request. Refusals skip the plugin and all post-handler processing, and answer through `auth-refusal.ts`. Rate limiting and Turnstile run first; two-factor enforcement, audit, notifications and evidence run only after a handled plugin response.

- `auth-session-read.ts` owns the one session read: `server/auth.ts`'s gates and the catchall's guards share the request's `auth.session` memo slot; the two-factor gate reads a minted cookie unmemoized.

- `plugin-call.ts` uses effectful-better-auth's `full` API for session-bound operations. `auth-response.ts` captures success and typed-error cookies before unwrapping data. `request-context.ts` stores each Set-Cookie value in the current AsyncLocalStorage scope; `start.ts` attaches them after response/error assembly. Preserve separate values, including Expires commas. Direct auth response cookies follow earlier captured cookies, so the handler's final rotation wins. Own-session reads also capture rotations; inspection/revocation of a refused minted credential deliberately does not install its cookies on the caller. No framework cookie plugin is installed.

- `http/page-loader.ts` reads one workspace gate payload, including suspension and `strongAuthenticationRequired`, before rendering. It redirects suspended workspaces to `/suspended` and unverified owners/admins to `/verify-authentication?redirect=…`. This gate covers workspace pages, wider than `authorize.ts`, where only `requireWorkspacePermission` hard-gates and dashboard segments use `whenPermitted`. An owner/admin whose strong-auth window lapsed verifies at the page boundary. `needsStrongAuthentication` names only owners, admins and system admins. `/suspended` is exempt because it maps to `credential_recovery`. The evidence read joins `strongAuthenticationStatusFor`'s per-request memo slot.

- Turnstile gates every anonymous mail-an-address POST: sign-up, magic link, one-time code, password reset and verification email. Native auth/account subscriptions own widget setup and cleanup. Browser auth ports send the token in `x-turnstile-token`. With TURNSTILE unset the site key is `null`, no widget renders and the gate answers `inactive` (ADR 0031).

- `lib/rate-limit.ts` trusts only `cf-connecting-ip`; email-OTP, magic-link and reset sends, second-factor checks, and session-free SSO routing share sign-in's `auth_sign_in` bucket (ADR 0030).

- Non-disclosure is a rule: constant responses on `/forgot-password`, `disableSignUp` on email-OTP, one opaque failure on `/invitations/accept` and link landings.

- `authAvailability()` selects the real plugin runtime only when D1 exists. Session reads answer anonymous without D1; auth and discovery HTTP handlers answer the local setup guidance 503. Plugin operations reject explicitly. Never fabricate a partial Better Auth service.
- `auth-audit/exchanges.ts` owns endpoint attribution and recovery policies. The request guard resolves admin session-token targets before the plugin deletes them and shares that target with audit and recovery evidence. Installed Better Auth endpoint contracts are checked by `endpoint-contract.test.ts`.
