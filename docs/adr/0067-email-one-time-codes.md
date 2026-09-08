# Email one-time codes

Better Auth's email-OTP plugin supports sign-in, verification, and password reset with hashed six-digit codes, ten-minute expiry, and three attempts. Code sign-in only opens existing accounts; it cannot bypass the registration flow by creating one. Emailed links remain available and the shared dispatcher keeps local development provider-light.

OTP endpoints use the sensitive sign-in rate-limit bucket. Send responses do not reveal whether an account exists; pages may repeat the visitor's own submitted address. Audits record the resulting sign-in, verification, or reset rather than every code send.
