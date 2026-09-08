# Repository-local Oxlint rules

A repository-local Oxlint plugin enforces conventions that upstream rules cannot express, including declaration-merge placement and context. Upstream rules remain preferable when they already enforce the policy. Local rules are syntax-only and run against the real linter in fixture tests, keeping checks consistent with CI rather than simulating plugin execution. Rule inventories and scoped exceptions belong in the plugin and lint configuration.
