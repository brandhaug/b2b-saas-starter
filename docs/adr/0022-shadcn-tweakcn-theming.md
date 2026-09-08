# Semantic tokens and one color scheme

The public site and authenticated app share shadcn semantic tokens and one Catppuccin Mocha scheme in `apps/web/src/index.css`. Keeping one palette makes contrast review tractable. The root retains `dark` because shadcn primitives use `dark:` variants; there is no runtime theme switch.

Components consume semantic tokens. TweakCN is an optional code-authoring tool for replacing the palette, not an in-app theme editor. [DESIGN.md](../../DESIGN.md) owns the visual rules.
