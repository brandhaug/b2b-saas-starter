# OpenTelemetry exports scoped per invocation

Each worker invocation owns its OTLP exporter scope, which flushes before that invocation loses permission to perform I/O. Isolate-scoped exporters could attempt later flushes against an ended request. Console logging remains isolate-scoped and works without an exporter endpoint. Optional vendor integrations follow the same invocation lifetime.

The web request middleware opens one scope shared by loader and server-function effects. A request-keyed registry prevents concurrent requests from sharing context; standalone work gets an explicitly tagged fallback scope. HTTP and queue trace propagation connect worker hops, while the wide event remains the request summary. Effect instrumentation avoids maintaining a second tracing stack.
