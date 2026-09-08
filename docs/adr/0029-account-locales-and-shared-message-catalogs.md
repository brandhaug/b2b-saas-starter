# Account locales and shared message catalogs

English and Norwegian Bokmål use shared Paraglide catalogs across UI and email. Account language is independent of workspace membership, so each person can choose their own locale and background mail can resolve the recipient's preference.

Public URLs select language through `/en/` or `/nb/`. Authenticated paths retain their addresses and prefer the account setting over browser preferences. Request-isolated SSR serializes locale and time zone for consistent hydration. Language changes use document navigation with a warning after form edits.

System notifications store event data so older notifications follow a language change. User-written announcements keep their original text. Web errors expose allowlisted codes for client translation; logs and API identifiers remain English. Technical articles remain English with translated navigation.

Time zone is a separate account preference; browser detection fills only an unset value. Anonymous formatting uses UTC. Catalog checks reject missing translations and inconsistent placeholders. Automatic translation, currency conversion, and regional business rules are outside this decision.
