# Per-capability services with Seed and Live adapters

Each capability exposes an Effect service with deterministic Seed and persistent Live adapters. Consumers compose exported layers instead of reaching into fixtures or storage. Shared behavior must include errors, ordering, authorization inputs, and mutation effects, since the same demo identity can cross Seed client navigation and Live server loads. This keeps transport code independent of storage without hiding every use case behind one workspace service.
