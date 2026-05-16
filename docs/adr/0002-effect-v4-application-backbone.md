# Effect v4 application backbone

Effect v4 is the application backbone across server, domain, infrastructure, typed HTTP contracts, and client data fetching. The React UI should stay idiomatic React/TanStack for rendering, but capability reads should follow the Hexwardens pattern of Effect `HttpApi` contracts, `AtomHttpApi.Service`, `@effect/atom-react` query atoms, and `FetchHttpClient` with schema decoding instead of ad hoc fetch wrappers.
