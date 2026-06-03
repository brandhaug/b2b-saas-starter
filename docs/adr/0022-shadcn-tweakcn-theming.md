# shadcn and TweakCN theming

The starter uses shadcn/ui components, Tailwind CSS v4 theme tokens, and light/dark mode from the start. The shipped theme is a self-contained set of semantic shadcn tokens defined in `apps/web/src/index.css` rather than a port of a specific named theme; TweakCN is recommended to builders as an external tool for generating alternate shadcn-compatible token sets. Components must use semantic shadcn tokens rather than raw one-off colors. The app exposes light/dark mode only; broader theme customization is a code-level workflow, not an in-app theme builder.
