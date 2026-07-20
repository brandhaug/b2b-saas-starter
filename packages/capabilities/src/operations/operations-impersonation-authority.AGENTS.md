# Operations Impersonation Authority

Authorizes every protected Merchant request made through an Impersonated Merchant
Session. It rechecks current operator, target, Merchant membership, Operator Session,
TOTP enrollment, permission, impersonation lifecycle, and expiry facts from D1.

Effective authority is the intersection of the target Merchant Member's authority
and the explicit impersonation allowlist. Denied mutations and designated sensitive
reads append correctly attributed Operations audit evidence; permitted mutations
return an authorization context that the Merchant boundary must use to record their
eventual result.
