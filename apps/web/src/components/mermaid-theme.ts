/* oxlint-disable starter/no-hex-color -- mermaid needs concrete color values:
 * it interpolates and parses them in JS (d3-color), so CSS custom properties
 * cannot cross that boundary the way chart-colors.ts hands recharts
 * `var(--chart-1)` for CSS-side fills. Every literal here mirrors the Catppuccin
 * Mocha token of the same name in apps/web/src/index.css, the file that stays
 * the one source of these values; change a token there, change its mirror here.
 */

/**
 * `themeVariables` for mermaid's `theme: 'base'`, mapped from the app tokens.
 * Text pairings clear 4.5:1 (the axe complaint was edge labels at 4.43:1):
 * foreground #cdd6f4 reads 11–12:1 on base/mantle fills and 6.3:1+ on the
 * surface fills; crust #11111b on mauve is 9.2:1. Lines and borders (non-text,
 * 3:1) sit at 4.1:1 or better.
 */
export type MermaidTheme = {
  /** SVG canvas — `--background` (mocha base). */
  readonly background: string
  /** Emphasized node fill — `--primary` (mauve). */
  readonly primaryColor: string
  /** Text on mauve — `--primary-foreground` (crust). */
  readonly primaryTextColor: string
  /** Outline on mauve — `--border` (surface0). */
  readonly primaryBorderColor: string
  /** Secondary node fill — `--secondary` (surface0). */
  readonly secondaryColor: string
  /** Text on surface0 — `--foreground`. */
  readonly secondaryTextColor: string
  /** Outline on surface0 — `--muted-foreground` (subtext0). */
  readonly secondaryBorderColor: string
  /** Tertiary node fill — `--accent` (surface1). */
  readonly tertiaryColor: string
  /** Text on surface1 — `--foreground`. */
  readonly tertiaryTextColor: string
  /** Outline on surface1 — `--muted-foreground`. */
  readonly tertiaryBorderColor: string
  /** Default label color — `--foreground`. */
  readonly textColor: string
  /**
   * Node label color, pinned to `--foreground`. `theme: 'base'` derives node
   * text from `primaryTextColor` (crust, for text on the mauve fill), which
   * painted every default node's label crust-on-mantle — 1.07:1, invisible.
   * `nodeTextColor` overrides that derivation for label text.
   */
  readonly nodeTextColor: string
  /** Edges and arrows — `--muted-foreground` (subtext0). */
  readonly lineColor: string
  /** Default flowchart node fill — `--card` (mantle). */
  readonly mainBkg: string
  /** Default flowchart node outline — `--muted-foreground`. */
  readonly nodeBorder: string
  /** Plate behind edge labels — `--card` (mantle). */
  readonly edgeLabelBackground: string
  /** Subgraph fill — `--card` (mantle). */
  readonly clusterBkg: string
  /** Subgraph outline — `--muted-foreground`. */
  readonly clusterBorder: string
  /** Mirrors `--font-sans`; mermaid interpolates this into the SVG's CSS. */
  readonly fontFamily: string
}

export const MERMAID_THEME: MermaidTheme = {
  background: '#1e1e2e',
  primaryColor: '#cba6f7',
  primaryTextColor: '#11111b',
  primaryBorderColor: '#313244',
  secondaryColor: '#313244',
  secondaryTextColor: '#cdd6f4',
  secondaryBorderColor: '#a6adc8',
  tertiaryColor: '#45475a',
  tertiaryTextColor: '#cdd6f4',
  tertiaryBorderColor: '#a6adc8',
  textColor: '#cdd6f4',
  nodeTextColor: '#cdd6f4',
  lineColor: '#a6adc8',
  mainBkg: '#181825',
  nodeBorder: '#a6adc8',
  edgeLabelBackground: '#181825',
  clusterBkg: '#181825',
  clusterBorder: '#a6adc8',
  fontFamily: 'Geist Variable, ui-sans-serif, sans-serif, system-ui'
}
