# Magic-link local authentication

Better Auth's magic-link plugin owns single-use, ten-minute tokens stored hashed in its verification table. Email uses the existing dispatcher, including local log mode. Link sign-up is allowed because consuming the link verifies mailbox control.

The emailed URL reaches the auth endpoint, which consumes the token, sets the cookie, and redirects to the app. A route loader must not consume it or attempt to recreate the session exchange. Sending uses the sensitive auth bucket and configured Turnstile; verification records the sign-in outcome. Invalid, expired, and consumed links share one failure state.
