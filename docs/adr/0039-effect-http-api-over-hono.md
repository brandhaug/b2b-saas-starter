# Effect HTTP API for contracts and routing

The API worker serves `StarterApi` through Effect HTTP API handler layers. Routing, schema decoding, status codes, OpenAPI, and the typed client therefore use one contract. A parallel router would permit served behavior to drift from declared endpoints and errors. Request-scoped services supply authorization, rate limiting, and observability to these handlers.
