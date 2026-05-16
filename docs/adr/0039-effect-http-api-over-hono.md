# Effect HTTP API over Hono

The API worker should prefer Effect's HTTP API stack for REST contracts and routing instead of Hono. This keeps REST definitions aligned with Effect schemas, typed errors, AtomHttpApi clients, and shared capabilities; Contributor's Hono and Scalar setup can inform the reference docs, but the starter should avoid maintaining a parallel routing model unless a specific integration requires it.
