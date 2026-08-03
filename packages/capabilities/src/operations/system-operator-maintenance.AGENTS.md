# System Operator Maintenance

This capability is the only non-web seam for first-operator bootstrap and
emergency second-factor recovery. It targets an existing verified identity that
is already classified as a System Operator; it must never reclassify a Merchant
Member or Customer Account.

Unlike authenticated Operations workstreams, bootstrap cannot supply an Operator
Session because it establishes the first authority. Both commands therefore
require an explicit maintainer actor label, target environment, and exact target
email confirmation. The actor label is durable operational attribution, not an
authorization credential. Production execution additionally requires the remote
target switch.

Every accepted state change and its global audit evidence belong to one D1 batch.
Recovery revokes Operator and derived impersonation sessions before clearing the
old factor. A disabled factor is the durable requirement for the shared Operator
Enrollment flow to issue fresh TOTP and backup codes; password-only Operations
access remains unavailable.
