# Transactional Email

This capability owns BeeSolo's required email-readiness seam. It distinguishes
local capture, provider acceptance, trustworthy delivery callbacks, and terminal
failure. Provider acceptance must never be presented as delivery.

Only versioned Romanian and English BeeSolo templates are accepted. Raw
destinations, rendered bodies, provider references, callback payloads, and secrets
must not appear in ordinary evidence or logs. Production fails closed when the
provider binding, verified platform sender, or callback secret is absent.

Appointment, Walk-in, Waiting List, and reminder producers remain outside this
leaf until their own implementation tickets migrate onto this boundary.
