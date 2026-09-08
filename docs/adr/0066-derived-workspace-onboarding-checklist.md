# Derived workspace onboarding

The dashboard computes onboarding progress from capability state, so a removed resource can reopen its step. Only workspace dismissal is stored and audited. Owner/admin permission controls dismissal; members see permitted steps read-only.

The projection receives authorization decisions from its entry point and skips unauthorized capability reads. Hiding a rendered step would still leak its data in the loader payload, while stored completion flags would create another source of truth.
