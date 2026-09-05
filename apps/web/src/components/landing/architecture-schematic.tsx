/* oxlint-disable jsx-a11y/prefer-tag-over-role -- inline SVG can't be an <img>; role="img" + aria-label is the canonical pattern */

/**
 * The schematic's addressable nodes: the stage a narrative scroll is on can
 * light the node it is discussing (peach fill + stroke), so the diagram works
 * as a "you are here" map, not just an artifact.
 */
export type SchematicNode =
  | 'browser'
  | 'curl'
  | 'mcp'
  | 'queue'
  | 'web'
  | 'api'
  | 'background'
  | 'capabilities'
  | 'd1'
  | 'queues'
  | 'email'

const ACTIVE_NODE_CLASSES = 'fill-signal/15 stroke-signal'
const ACTIVE_TEXT_CLASSES = 'fill-signal'

/**
 * Wiring diagram of the actual monorepo topology, drawn as an engineering
 * schematic. Every label is a real path in this repository. Amber pulses
 * trace request/job flow; they are hidden under prefers-reduced-motion
 * (see `.schematic-pulse` in index.css).
 *
 * Two variants of the same drawing: `full` (the default) is the scrollable
 * figure above the narrative spine; `dense` is the sticky rail's copy — a
 * compact redraw whose labels are pinned to 11 CSS pixels rather than scaled
 * down with the canvas. The rail renders at one fixed content width (the
 * 25rem column minus its card padding = 368px, which is also the dense
 * viewBox width), so 11 viewBox units land as 11px on screen — the difference
 * between a map that can be read and dark smudges at 5–7px.
 */
export function ArchitectureSchematic({
  activeNodes,
  variant = 'full',
  className
}: {
  /** Nodes currently under discussion; none renders the resting schematic. */
  readonly activeNodes?: ReadonlyArray<SchematicNode>
  /** `dense` redraws for the sticky rail at fixed 11px labels. */
  readonly variant?: 'full' | 'dense'
  /** Sizing override — `full` defaults to its natural width, `dense` fills. */
  readonly className?: string
}) {
  return variant === 'dense' ? (
    <DenseSchematic
      {...(activeNodes === undefined ? {} : { activeNodes })}
      className={className}
    />
  ) : (
    <FullSchematic
      {...(activeNodes === undefined ? {} : { activeNodes })}
      className={className ?? 'w-full min-w-135'}
    />
  )
}

const SCHEMATIC_ARIA =
  'Schematic of the starter architecture: browser, REST and MCP clients, and queue jobs flow into the web, api, and background Workers, through the shared capabilities package, to D1, Queues, and Email.'

function FullSchematic({
  activeNodes,
  className
}: {
  readonly activeNodes?: ReadonlyArray<SchematicNode> | undefined
  readonly className: string
}) {
  const active = new Set(activeNodes)
  return (
    <svg
      viewBox="0 0 560 460"
      role="img"
      aria-label={SCHEMATIC_ARIA}
      className={className}
    >
      <title>Request topology of the B2B SaaS Starter</title>

      {/* wire routes (also used as pulse motion paths) — strokes at /60 clear
          the 3:1 non-text contrast bar against the card surface; /45 did not */}
      <g className="stroke-muted-foreground/60" fill="none" strokeWidth="1">
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
        <path id="route-queue-webhooks" d="M128 312 H411 V200 H470" />
        <path id="route-queue-email" d="M128 312 H411 V300 H470" />
      </defs>

      {/* clients (external world: dashed) */}
      <g>
        <ClientNode x={16} y={48} label="browser" active={active.has('browser')} />
        <ClientNode x={16} y={128} label="curl / SDK" active={active.has('curl')} />
        <ClientNode x={16} y={188} label="MCP client" active={active.has('mcp')} />
        <ClientNode x={16} y={294} label="queue jobs" active={active.has('queue')} />
      </g>

      {/* workers */}
      <WorkerNode
        x={196}
        y={40}
        h={52}
        label="apps/web"
        sub="Worker · TanStack Start"
        active={active.has('web')}
      />
      <WorkerNode
        x={196}
        y={136}
        h={76}
        label="apps/api"
        sub="Worker · REST + MCP"
        active={active.has('api')}
      />
      <WorkerNode
        x={196}
        y={286}
        h={52}
        label="apps/background"
        sub="Worker · queue consumer"
        active={active.has('background')}
      />

      {/* capabilities spine */}
      <g>
        <rect
          x="398"
          y="40"
          width="26"
          height="298"
          className={
            active.has('capabilities')
              ? `transition-colors duration-300 ${ACTIVE_NODE_CLASSES}`
              : 'fill-primary/10 stroke-primary/60 transition-colors duration-300'
          }
          strokeWidth="1"
        />
        <text
          transform="rotate(-90 411 189)"
          x="411"
          y="189"
          textAnchor="middle"
          dominantBaseline="central"
          className={`font-mono text-3xs transition-colors duration-300 ${
            active.has('capabilities') ? ACTIVE_TEXT_CLASSES : 'fill-primary'
          }`}
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
      <InfraNode x={470} y={60} label="D1" active={active.has('d1')} />
      <InfraNode x={470} y={180} label="Queues" active={active.has('queues')} />
      <InfraNode x={470} y={280} label="Email" active={active.has('email')} />

      {/* signal pulses */}
      <g className="schematic-pulse">
        <Pulse href="#route-browser-d1" dur="4s" begin="0s" />
        <Pulse href="#route-rest-d1" dur="4.6s" begin="1.4s" />
        <Pulse href="#route-queue-webhooks" dur="5.2s" begin="2.6s" />
        <Pulse href="#route-queue-email" dur="5.8s" begin="3.8s" />
      </g>

      {/* registration marks */}
      <g className="stroke-muted-foreground/60" strokeWidth="1">
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
          className="fill-muted-foreground text-4xs"
          dominantBaseline="middle"
        >
          B2B-SAAS-STARTER · REQUEST TOPOLOGY
        </text>
        <text
          x="344"
          y="437"
          className="fill-muted-foreground text-4xs"
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
  label,
  active = false
}: {
  readonly x: number
  readonly y: number
  readonly label: string
  readonly active?: boolean
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width="112"
        height="36"
        className={
          active
            ? `transition-colors duration-300 ${ACTIVE_NODE_CLASSES}`
            : 'fill-transparent stroke-muted-foreground/60 transition-colors duration-300'
        }
        strokeWidth="1"
        strokeDasharray="4 3"
      />
      <text
        x={x + 56}
        y={y + 18}
        textAnchor="middle"
        dominantBaseline="central"
        className={`font-mono text-3xs transition-colors duration-300 ${
          active ? ACTIVE_TEXT_CLASSES : 'fill-muted-foreground'
        }`}
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
  sub,
  active = false
}: {
  readonly x: number
  readonly y: number
  readonly h: number
  readonly label: string
  readonly sub: string
  readonly active?: boolean
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width="140"
        height={h}
        className={
          active
            ? `transition-colors duration-300 ${ACTIVE_NODE_CLASSES}`
            : 'fill-card stroke-foreground/60 transition-colors duration-300'
        }
        strokeWidth="1"
      />
      <rect x={x + 128} y={y + 6} width="5" height="5" className="fill-signal" />
      <text
        x={x + 12}
        y={y + h / 2 - 7}
        className={`font-mono text-2xs font-medium transition-colors duration-300 ${
          active ? ACTIVE_TEXT_CLASSES : 'fill-foreground'
        }`}
      >
        {label}
      </text>
      <text
        x={x + 12}
        y={y + h / 2 + 9}
        className="fill-muted-foreground font-mono text-4xs"
      >
        {sub}
      </text>
    </g>
  )
}

function InfraNode({
  x,
  y,
  label,
  active = false
}: {
  readonly x: number
  readonly y: number
  readonly label: string
  readonly active?: boolean
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width="74"
        height="40"
        className={
          active
            ? `transition-colors duration-300 ${ACTIVE_NODE_CLASSES}`
            : 'fill-secondary stroke-muted-foreground/60 transition-colors duration-300'
        }
        strokeWidth="1"
      />
      <text
        x={x + 37}
        y={y + 20}
        textAnchor="middle"
        dominantBaseline="central"
        className={`font-mono text-3xs transition-colors duration-300 ${
          active ? ACTIVE_TEXT_CLASSES : 'fill-foreground'
        }`}
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

/**
 * The rail's redraw of the same topology: same nodes, same wires, same
 * highlight vocabulary — sized so every label is exactly 11px. No sub-labels,
 * no title block (the rail's caption below the drawing does that work), and
 * wires only where a dense canvas keeps them legible.
 */
function DenseSchematic({
  activeNodes,
  className = 'w-full'
}: {
  readonly activeNodes?: ReadonlyArray<SchematicNode> | undefined
  readonly className?: string | undefined
}) {
  const active = new Set(activeNodes)
  // Node geometry: clients x=0 w=84 h=26; workers x=132 w=112; spine x=272
  // w=14; infra x=306 w=62 h=32. Rows keep the full variant's pairing.
  return (
    <svg
      viewBox="0 0 368 278"
      role="img"
      aria-label={SCHEMATIC_ARIA}
      className={className}
    >
      <title>Request topology of the B2B SaaS Starter</title>

      <g className="stroke-muted-foreground/60" fill="none" strokeWidth="1">
        <path d="M84 25 H132" strokeDasharray="4 3" />
        <path d="M84 101 H132" strokeDasharray="4 3" />
        <path d="M84 161 H132" strokeDasharray="4 3" />
        <path d="M84 245 H132" strokeDasharray="4 3" />
        <path d="M244 25 H272" />
        <path d="M244 124 H272" />
        <path d="M244 245 H272" />
        <path d="M286 52 H306" />
        <path d="M286 152 H306" />
        <path d="M286 245 H306" />
      </g>

      <defs>
        <path
          id="dense-route-browser-d1"
          d="M84 25 H244 V124 H272 M286 52 H296 V245 H306"
        />
        <path id="dense-route-rest-d1" d="M84 101 H132 M244 124 H272 M286 52 H306" />
        <path id="dense-route-queue-email" d="M84 245 H244 V245 H272 M286 245 H306" />
      </defs>

      <g>
        <DenseNode
          x={0}
          y={12}
          w={84}
          label="browser"
          dashed
          active={active.has('browser')}
        />
        <DenseNode
          x={0}
          y={88}
          w={84}
          label="curl / SDK"
          dashed
          active={active.has('curl')}
        />
        <DenseNode
          x={0}
          y={148}
          w={84}
          label="MCP client"
          dashed
          active={active.has('mcp')}
        />
        <DenseNode
          x={0}
          y={232}
          w={84}
          label="queue jobs"
          dashed
          active={active.has('queue')}
        />
      </g>

      <g>
        <DenseNode x={132} y={12} w={112} label="apps/web" active={active.has('web')} />
        <DenseNode x={132} y={76} w={112} label="apps/api" active={active.has('api')} />
        <DenseNode
          x={132}
          y={232}
          w={112}
          label="apps/background"
          active={active.has('background')}
        />
      </g>

      <g>
        <rect
          x="272"
          y="12"
          width="14"
          height="246"
          className={
            active.has('capabilities')
              ? `transition-colors duration-300 ${ACTIVE_NODE_CLASSES}`
              : 'fill-primary/10 stroke-primary/60 transition-colors duration-300'
          }
          strokeWidth="1"
        />
        <text
          transform="rotate(-90 279 135)"
          x="279"
          y="135"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="11"
          className={`font-mono transition-colors duration-300 ${
            active.has('capabilities') ? ACTIVE_TEXT_CLASSES : 'fill-primary'
          }`}
        >
          capabilities
        </text>
        {[25, 124, 245].map((y) => (
          <circle
            key={`l${y}`}
            cx="272"
            cy={y}
            r="2.5"
            className="fill-background stroke-primary/70"
            strokeWidth="1"
          />
        ))}
        {[52, 152, 245].map((y) => (
          <circle
            key={`r${y}`}
            cx="286"
            cy={y}
            r="2.5"
            className="fill-background stroke-primary/70"
            strokeWidth="1"
          />
        ))}
      </g>

      <g>
        <DenseNode x={306} y={36} w={62} label="D1" active={active.has('d1')} />
        <DenseNode
          x={306}
          y={136}
          w={62}
          label="Queues"
          active={active.has('queues')}
        />
        <DenseNode x={306} y={229} w={62} label="Email" active={active.has('email')} />
      </g>

      <g className="schematic-pulse">
        <Pulse href="#dense-route-browser-d1" dur="4s" begin="0s" />
        <Pulse href="#dense-route-rest-d1" dur="4.6s" begin="1.4s" />
        <Pulse href="#dense-route-queue-email" dur="5.2s" begin="2.6s" />
      </g>
    </svg>
  )
}

/** One dense box's resting classes: active lights it, dashed marks the
 * external world, otherwise it is a worker on the card surface. */
function denseNodeClasses(active: boolean, dashed: boolean): string {
  if (active) {
    return `transition-colors duration-300 ${ACTIVE_NODE_CLASSES}`
  }
  if (dashed) {
    return 'fill-transparent stroke-muted-foreground/60 transition-colors duration-300'
  }
  return 'fill-card stroke-foreground/60 transition-colors duration-300'
}

/**
 * One dense box: label centered, 11px by attribute (not token) so the rail's
 * fixed-width canvas keeps it exactly that — Tailwind's `text-3xs` is 10px
 * before scaling and invisible at rail scale, which is what this variant
 * exists to fix.
 */
function DenseNode({
  x,
  y,
  w,
  label,
  dashed = false,
  active = false
}: {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly label: string
  readonly dashed?: boolean
  readonly active?: boolean
}) {
  const height = 26
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={height}
        className={denseNodeClasses(active, dashed)}
        strokeWidth="1"
        strokeDasharray={dashed ? '4 3' : undefined}
      />
      <text
        x={x + w / 2}
        y={y + height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="11"
        className={`font-mono transition-colors duration-300 ${
          active ? ACTIVE_TEXT_CLASSES : 'fill-foreground'
        }`}
      >
        {label}
      </text>
    </g>
  )
}
