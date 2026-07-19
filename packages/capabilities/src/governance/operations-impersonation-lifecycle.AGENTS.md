# Operations Impersonation Lifecycle

The lifecycle capability is the sole owner of Active presentation facts and terminal
Impersonation Record transitions. Its one-hour expiry is absolute: reads never extend
the record or Merchant Session.

Stopped, Expired, and Revoked transitions update the record, revoke the Impersonated
Merchant Session, append global audit evidence, and create the matching sanitized
Notification Intent in one D1 batch. Terminal results expose only the stable Merchant
and target identifiers needed to return the browser to Operations Member detail.

Merchant presentation may clear only the dedicated impersonation cookie. It must not
create, merge, restore, overwrite, or clear an independent normal Merchant Session or
the separate Operator Session.
