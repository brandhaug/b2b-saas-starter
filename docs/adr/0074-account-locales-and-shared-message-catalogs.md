# Account locales and shared message catalogs

The starter now ships English and Norwegian Bokmål across its user-facing UI
and email. This supersedes [ADR 0029](./0029-no-initial-i18n.md). Paraglide
compiles shared catalogs into typed functions usable by React, Workers, and
background jobs. Its TanStack Start integration supports request-isolated SSR;
language switches use document navigation, with a warning after form edits.

Public pages use `/en/` and `/nb/` prefixes. Authenticated app paths, authentication
callbacks, and API endpoints retain their existing addresses. A public URL picks
its language; inside the app the account preference wins over the browser cookie
and language header. Each person chooses their own language, independent of
workspace membership. Background email resolves the recipient's preference.

System notifications store event data so a language change also applies to older
notifications. User-written announcements stay in their original language. Web
errors serialize allowlisted codes and details, then resolve display text in the
browser. Internal exceptions use a translated fallback. API identifiers and logs
stay English.

Language and time zone are independent. English formats as `en-US`, Bokmål as
`nb-NO`. Anonymous pages use UTC. After login, browser time-zone detection fills
an unset account preference without overwriting an existing choice. SSR settings
are serialized into the document so hydration formats the same timestamps.
Date-only values and stored monetary currencies retain their meaning.

Catalogs live in Git and builds reject missing translations or inconsistent
placeholders. Existing technical docs and blog articles remain explicitly
English; their surrounding navigation is translated. Automatic translation of
user content, currency conversion, regional business rules, and right-to-left
layouts are outside this delivery.
