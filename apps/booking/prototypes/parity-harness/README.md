# Parity Harness Prototype

> THROWAWAY PROTOTYPE — this is a decision aid, not the production verification harness.

## Question

Can one manifest-driven capture contract describe deterministic fixtures, browser actions, viewport and locale coverage, animation control, visual-diff policy, and evidence completeness while producing an unambiguous parity verdict?

The terminal UI exposes the proposed state model. Change the capture dimensions and simulate missing or divergent evidence; after every action it prints the complete manifest, evidence bundle, and acceptance verdict.

Run it from the repository root:

```bash
bun --cwd apps/booking prototype:parity-harness
```

The durable verdict belongs in the Wayfinder ticket. Delete this directory after that ticket records the accepted contract.
