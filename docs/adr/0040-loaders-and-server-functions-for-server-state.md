# Server state through page loaders and typed HTTP

Request-scoped page loaders call capability services directly. Browser operations use Effect HttpApi contracts with generated clients; server handlers recheck authority and call the same capabilities. The web app does not call its external REST API to reach those services.

Native Foldkit models and messages replace React and TanStack state. Commands return operation outcomes as messages; subscriptions and managed resources own observation and cleanup. Query-backed views preserve URL state. The user-approved migration retains SSR using exactly pinned experimental Foldkit packages. It does not relax authorization, error disclosure, localization or provider-light behavior. Upgrades require compiled-host and browser acceptance checks.

This replaces the original TanStack loader/server-function and Query implementation while retaining the in-process capability boundary.
