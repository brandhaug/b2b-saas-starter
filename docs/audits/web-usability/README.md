# Web usability captures

These captures show the consolidated public-page and command-menu refinements.
They come from the local development server with synthetic demo data. The
TanStack developer toolbar is visible. They are static layout evidence;
`apps/web/e2e/interaction-feedback.spec.ts` and
`apps/web/e2e/overlay-transitions.spec.ts` check the interactions.

| Capture                                    | Route and viewport                                         |
| ------------------------------------------ | ---------------------------------------------------------- |
| [Homepage](home-desktop.webp)              | `/en`, 1440 × 1000                                         |
| [Norwegian homepage](home-mobile-nb.webp)  | `/nb`, 390 × 844                                           |
| [Documentation](docs-desktop.webp)         | `/en/docs`, 1440 × 1000                                    |
| [Command menu](commands-short-screen.webp) | `/demo/api-tokens`, 390 × 400, open Search with Ctrl/Cmd+K |

The homepage retains Newsreader and the Catppuccin palette. The docs index puts
Quickstart first. The command dialog stays inside the short viewport and scrolls
its results independently.
