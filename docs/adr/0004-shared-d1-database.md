# Shared D1 database

The web, API, and background workers share one D1 database, including Better Auth and workspace tables. Schema and migrations belong to `packages/db`; separate databases require an operational ownership boundary that justifies losing this shared persistence model.
