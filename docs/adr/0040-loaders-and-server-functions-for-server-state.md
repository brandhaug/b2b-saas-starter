# Client server-state through loaders and server functions

TanStack Start loaders call capability services directly; mutations use server functions. The web app does not call its own external REST API to reach the same services. Selective polling and refresh can use TanStack Query. Introduce another general server-state abstraction only when a concrete interaction exceeds these mechanisms.
