# Deterministic seed workspace

Local development and tests share deterministic workspace data. `packages/capabilities/src/seed-fixture.ts` owns the demo identity and membership; `scripts/seed.ts` adds the password when populating D1. Seed and Live must resolve that identity to the same workspace because client navigation can use Seed while server loads use D1.
