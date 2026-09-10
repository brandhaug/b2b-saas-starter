/* oxlint-disable jsx-a11y/prefer-tag-over-role -- inline SVG uses role="img" for its accessible description */
import { useEffect, useRef, useState } from 'react'
import { m } from '@b2b-saas-starter/i18n/messages'

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

// The moving signals and resting wires share geometry so pulses never jump.
const CONNECTIONS = [
  { path: 'M52 66 V108', step: 0 },
  { path: 'M150 66 V84 Q150 92 158 92 H192 Q200 92 200 100 V108', step: 0 },
  { path: 'M248 66 V84 Q248 92 240 92 H208 Q200 92 200 100 V108', step: 0 },
  { path: 'M348 66 V108', step: 0 },
  { path: 'M52 170 V202 Q52 218 68 218 H184 Q200 218 200 234 V250', step: 1 },
  { path: 'M200 170 V250', step: 1 },
  { path: 'M348 170 V202 Q348 218 332 218 H216 Q200 218 200 234 V250', step: 1 },
  { path: 'M200 322 V342 Q200 358 184 358 H68 Q52 358 52 374 V402', step: 2 },
  { path: 'M200 322 V402', step: 2 },
  { path: 'M200 322 V342 Q200 358 216 358 H332 Q348 358 348 374 V402', step: 2 }
] satisfies ReadonlyArray<{ readonly path: string; readonly step: number }>

export function ArchitectureSchematic({
  activeNodes,
  className = 'w-full'
}: {
  readonly activeNodes?: ReadonlyArray<SchematicNode>
  readonly className?: string
}) {
  const active = new Set(activeNodes)
  const svgRef = useRef<SVGSVGElement | null>(null)
  // Ten paths animate `stroke-dashoffset` forever, which keeps the compositor
  // busy even when the schematic has scrolled away. The observer pauses them
  // off-screen. The default is `true` so the server render and the first
  // client paint agree and the animation never restarts on hydration; the
  // observer only ever pauses what is already out of view.
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const node = svgRef.current
    if (node === null || !('IntersectionObserver' in window)) {
      return
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        setVisible(entry.isIntersecting)
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 408 460"
      role="img"
      aria-label={m.public_architecture_aria()}
      className={className}
      data-schematic-visible={visible}
    >
      <title>{m.public_architecture_title()}</title>
      <g fill="none" strokeWidth="1" className="stroke-muted-foreground/70">
        {CONNECTIONS.map(({ path }) => (
          <path key={path} d={path} />
        ))}
      </g>
      <g
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        className="schematic-pulse stroke-signal"
      >
        {CONNECTIONS.map(({ path, step }) => (
          <path
            key={path}
            d={path}
            pathLength="100"
            className="trace-signal"
            style={{ animationDelay: `${step * 1.8}s` }}
          />
        ))}
      </g>
      <TraceNode
        x={8}
        y={26}
        width={88}
        label={m.shell_diagram_browser()}
        active={active.has('browser')}
        external
      />
      <TraceNode
        x={106}
        y={26}
        width={88}
        label="HTTP client"
        active={active.has('curl')}
        external
      />
      <TraceNode
        x={204}
        y={26}
        width={88}
        label={m.shell_diagram_mcp_client()}
        active={active.has('mcp')}
        external
      />
      <TraceNode
        x={302}
        y={26}
        width={92}
        label={m.shell_diagram_queue_jobs()}
        active={active.has('queue')}
        external
      />

      <TraceNode
        x={8}
        y={108}
        width={88}
        label="web"
        sub="TanStack Start"
        active={active.has('web')}
      />
      <TraceNode
        x={144}
        y={108}
        width={112}
        label="api"
        sub="REST + MCP"
        active={active.has('api')}
      />
      <TraceNode
        x={296}
        y={108}
        width={104}
        label="background"
        sub="queue consumer"
        active={active.has('background')}
      />

      <g className="trace-node" data-active={active.has('capabilities')}>
        <rect
          x="56"
          y="250"
          width="288"
          height="72"
          className="trace-node-body fill-signal/5 stroke-signal/50"
        />
        <text
          x="200"
          y="278"
          textAnchor="middle"
          className="fill-muted-foreground font-mono"
          fontSize="11"
        >
          packages/
        </text>
        <text
          x="200"
          y="301"
          textAnchor="middle"
          className="fill-signal font-mono font-medium"
          fontSize="18"
        >
          capabilities
        </text>
        <circle cx="200" cy="250" r="3" className="fill-signal" />
        <circle cx="200" cy="322" r="3" className="fill-signal" />
      </g>

      <TraceNode
        x={8}
        y={402}
        width={88}
        label="D1"
        active={active.has('d1')}
        external
      />
      <TraceNode
        x={144}
        y={402}
        width={112}
        label="Queues"
        active={active.has('queues')}
        external
      />
      <TraceNode
        x={296}
        y={402}
        width={104}
        label="Email"
        active={active.has('email')}
        external
      />
    </svg>
  )
}

function TraceNode({
  x,
  y,
  width,
  label,
  sub,
  active,
  external = false
}: {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly label: string
  readonly sub?: string
  readonly active: boolean
  readonly external?: boolean
}) {
  const height = external ? 40 : 62
  return (
    <g className="trace-node" data-active={active}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        className="trace-node-body fill-card stroke-border"
      />
      <text
        x={x + width / 2}
        y={y + (external ? 24 : 27)}
        textAnchor="middle"
        className="trace-node-label fill-foreground font-mono"
        fontSize={external ? 11 : 12}
      >
        {label}
      </text>
      {sub && (
        <text
          x={x + width / 2}
          y={y + 46}
          textAnchor="middle"
          className="fill-muted-foreground font-mono"
          fontSize="10"
        >
          {sub}
        </text>
      )}
      {!external && (
        <circle cx={x + width / 2} cy={y} r="2" className="fill-muted-foreground" />
      )}
    </g>
  )
}
