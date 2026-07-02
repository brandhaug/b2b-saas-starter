/* oxlint-disable jsx-a11y/prefer-tag-over-role -- inline SVG can't be an <img>; role="img" + aria-label is the canonical pattern */

/**
 * Wiring diagram of the actual monorepo topology, drawn as an engineering
 * schematic. Every label is a real path in this repository. Amber pulses
 * trace request/job flow; they are hidden under prefers-reduced-motion
 * (see `.schematic-pulse` in index.css).
 */
export function ArchitectureSchematic() {
  return (
    <svg
      viewBox="0 0 560 460"
      role="img"
      aria-label="Schematic of the starter architecture: browser, REST and MCP clients, and cron triggers flow into the web, api, and background Workers, through the shared capabilities package, to D1, Queues, and Email."
      className="w-full min-w-[540px]"
    >
      <title>Request topology of the B2B SaaS Starter</title>

      {/* wire routes (also used as pulse motion paths) */}
      <g className="stroke-muted-foreground/45" fill="none" strokeWidth="1">
        <path d="M128 66 H196" strokeDasharray="4 3" />
        <path d="M128 146 H172 V152 H196" strokeDasharray="4 3" />
        <path d="M128 206 H172 V196 H196" strokeDasharray="4 3" />
        <path d="M128 312 H196" strokeDasharray="4 3" />
        <path d="M336 66 H398" />
        <path d="M336 174 H398" />
        <path d="M336 312 H398" />
        <path d="M424 80 H470" />
        <path d="M424 200 H470" />
        <path d="M424 300 H470" />
      </g>

      {/* invisible continuous routes for the pulses */}
      <defs>
        <path id="route-browser-d1" d="M128 66 H411 V80 H470" />
        <path id="route-rest-d1" d="M128 146 H411 V80 H470" />
        <path id="route-cron-queues" d="M128 312 H411 V200 H470" />
        <path id="route-cron-email" d="M128 312 H411 V300 H470" />
      </defs>

      {/* clients (external world: dashed) */}
      <g>
        <ClientNode x={16} y={48} label="browser" />
        <ClientNode x={16} y={128} label="curl / SDK" />
        <ClientNode x={16} y={188} label="MCP client" />
        <ClientNode x={16} y={294} label="cron · queue" />
      </g>

      {/* workers */}
      <WorkerNode
        x={196}
        y={40}
        h={52}
        label="apps/web"
        sub="Worker · TanStack Start"
      />
      <WorkerNode x={196} y={136} h={76} label="apps/api" sub="Worker · REST + MCP" />
      <WorkerNode
        x={196}
        y={286}
        h={52}
        label="apps/background"
        sub="Worker · cron + queue"
      />

      {/* capabilities spine */}
      <g>
        <rect
          x="398"
          y="40"
          width="26"
          height="298"
          className="fill-primary/10 stroke-primary/60"
          strokeWidth="1"
        />
        <text
          transform="rotate(-90 411 189)"
          x="411"
          y="189"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-primary font-mono text-[10px]"
        >
          packages/capabilities
        </text>
        {/* junction ports on the spine */}
        {[66, 80, 174, 200, 300, 312].map((y) => (
          <circle
            key={y}
            cx={y === 66 || y === 174 || y === 312 ? 398 : 424}
            cy={y}
            r="2.5"
            className="fill-background stroke-primary/70"
            strokeWidth="1"
          />
        ))}
      </g>

      {/* infrastructure */}
      <InfraNode x={470} y={60} label="D1" />
      <InfraNode x={470} y={180} label="Queues" />
      <InfraNode x={470} y={280} label="Email" />

      {/* signal pulses */}
      <g className="schematic-pulse">
        <Pulse href="#route-browser-d1" dur="4s" begin="0s" />
        <Pulse href="#route-rest-d1" dur="4.6s" begin="1.4s" />
        <Pulse href="#route-cron-queues" dur="5.2s" begin="2.6s" />
        <Pulse href="#route-cron-email" dur="5.8s" begin="3.8s" />
      </g>

      {/* registration marks */}
      <g className="stroke-muted-foreground/50" strokeWidth="1">
        <path d="M166 16 v8 M162 20 h8" />
        <path d="M166 428 v8 M162 432 h8" />
        <path d="M450 16 v8 M446 20 h8" />
      </g>

      {/* title block */}
      <g className="font-mono">
        <rect
          x="336"
          y="404"
          width="208"
          height="40"
          className="fill-transparent stroke-border"
          strokeWidth="1"
        />
        <line
          x1="336"
          y1="424"
          x2="544"
          y2="424"
          className="stroke-border"
          strokeWidth="1"
        />
        <text
          x="344"
          y="417"
          className="fill-muted-foreground text-[8px]"
          dominantBaseline="middle"
        >
          B2B-SAAS-STARTER · REQUEST TOPOLOGY
        </text>
        <text
          x="344"
          y="437"
          className="fill-muted-foreground text-[8px]"
          dominantBaseline="middle"
        >
          CLOUDFLARE-FIRST · ALCHEMY v2 · SHEET 1/1
        </text>
      </g>
    </svg>
  )
}

function ClientNode({
  x,
  y,
  label
}: {
  readonly x: number
  readonly y: number
  readonly label: string
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width="112"
        height="36"
        className="fill-transparent stroke-muted-foreground/50"
        strokeWidth="1"
        strokeDasharray="4 3"
      />
      <text
        x={x + 56}
        y={y + 18}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-muted-foreground font-mono text-[10px]"
      >
        {label}
      </text>
    </g>
  )
}

function WorkerNode({
  x,
  y,
  h,
  label,
  sub
}: {
  readonly x: number
  readonly y: number
  readonly h: number
  readonly label: string
  readonly sub: string
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width="140"
        height={h}
        className="fill-card stroke-foreground/60"
        strokeWidth="1"
      />
      <rect x={x + 128} y={y + 6} width="5" height="5" className="fill-signal" />
      <text
        x={x + 12}
        y={y + h / 2 - 7}
        className="fill-foreground font-mono text-[11px] font-medium"
      >
        {label}
      </text>
      <text
        x={x + 12}
        y={y + h / 2 + 9}
        className="fill-muted-foreground font-mono text-[8.5px]"
      >
        {sub}
      </text>
    </g>
  )
}

function InfraNode({
  x,
  y,
  label
}: {
  readonly x: number
  readonly y: number
  readonly label: string
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width="74"
        height="40"
        className="fill-secondary stroke-muted-foreground/60"
        strokeWidth="1"
      />
      <text
        x={x + 37}
        y={y + 20}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground font-mono text-[10px]"
      >
        {label}
      </text>
    </g>
  )
}

function Pulse({
  href,
  dur,
  begin
}: {
  readonly href: string
  readonly dur: string
  readonly begin: string
}) {
  return (
    <circle r="3" className="fill-signal">
      <animateMotion dur={dur} begin={begin} repeatCount="indefinite">
        <mpath href={href} />
      </animateMotion>
    </circle>
  )
}
