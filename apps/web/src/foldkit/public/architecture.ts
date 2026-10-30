import { type HtmlBuilder, type Html } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'

const connections = [
  'M52 66 V108',
  'M150 66 V84 Q150 92 158 92 H192 Q200 92 200 100 V108',
  'M248 66 V84 Q248 92 240 92 H208 Q200 92 200 100 V108',
  'M348 66 V108',
  'M52 170 V202 Q52 218 68 218 H184 Q200 218 200 234 V250',
  'M200 170 V250',
  'M348 170 V202 Q348 218 332 218 H216 Q200 218 200 234 V250',
  'M200 322 V342 Q200 358 184 358 H56 Q40 358 40 374 V402',
  'M200 322 V350 Q200 366 184 366 H168 Q152 366 152 382 V402',
  'M200 322 V350 Q200 366 216 366 H256 Q272 366 272 382 V402',
  'M200 322 V342 Q200 358 216 358 H344 Q360 358 360 374 V402'
]
export function architecture<M>(
  h: HtmlBuilder<M>,
  activeNodes: ReadonlyArray<string> = []
): Html {
  function node(
    id: string,
    x: number,
    y: number,
    width: number,
    label: string,
    sub: string | null = null
  ): Html {
    return h.g(
      [
        h.Class('trace-node'),
        h.Attribute('data-active', String(activeNodes.includes(id)))
      ],
      [
        h.rect([
          h.Attribute('x', String(x)),
          h.Attribute('y', String(y)),
          h.Width(String(width)),
          h.Height(sub === null ? '40' : '62'),
          h.Class('trace-node-body fill-card stroke-border')
        ]),
        h.text(
          [
            h.Attribute('x', String(x + width / 2)),
            h.Attribute('y', String(y + (sub === null ? 24 : 27))),
            h.Attribute('text-anchor', 'middle'),
            h.Class('trace-node-label fill-foreground font-mono'),
            h.Attribute('font-size', sub === null ? '11' : '12')
          ],
          [label]
        ),
        sub === null
          ? null
          : h.text(
              [
                h.Attribute('x', String(x + width / 2)),
                h.Attribute('y', String(y + 46)),
                h.Attribute('text-anchor', 'middle'),
                h.Class('fill-muted-foreground font-mono'),
                h.Attribute('font-size', '10')
              ],
              [sub]
            ),
        sub === null
          ? null
          : h.circle([
              h.Attribute('cx', String(x + width / 2)),
              h.Attribute('cy', String(y)),
              h.Attribute('r', '2'),
              h.Class('fill-muted-foreground')
            ])
      ]
    )
  }
  return h.svg(
    [
      h.Attribute('viewBox', '0 0 408 460'),
      h.Role('img'),
      h.AriaLabel(m.public_architecture_aria()),
      h.Class('w-full')
    ],
    [
      h.title([], [m.public_architecture_title()]),
      h.g(
        [
          h.Attribute('fill', 'none'),
          h.Attribute('stroke-width', '1'),
          h.Class('stroke-muted-foreground/70')
        ],
        connections.map((path) => h.path([h.Attribute('d', path)]))
      ),
      node('browser', 8, 26, 88, m.shell_diagram_browser()),
      node('curl', 106, 26, 88, 'HTTP client'),
      node('mcp', 204, 26, 88, m.shell_diagram_mcp_client()),
      node('queue', 302, 26, 92, m.shell_diagram_queue_jobs()),
      node('web', 8, 108, 88, 'web', 'Foldkit'),
      node('api', 144, 108, 112, 'api', 'REST + MCP'),
      node('background', 296, 108, 104, 'background', 'queue consumer'),
      h.g(
        [
          h.Class('trace-node'),
          h.Attribute('data-active', String(activeNodes.includes('capabilities')))
        ],
        [
          h.rect([
            h.Attribute('x', '56'),
            h.Attribute('y', '250'),
            h.Width('288'),
            h.Height('72'),
            h.Class('trace-node-body fill-signal/5 stroke-signal/50')
          ]),
          h.text(
            [
              h.Attribute('x', '200'),
              h.Attribute('y', '278'),
              h.Attribute('text-anchor', 'middle'),
              h.Class('fill-muted-foreground font-mono'),
              h.Attribute('font-size', '11')
            ],
            ['packages/']
          ),
          h.text(
            [
              h.Attribute('x', '200'),
              h.Attribute('y', '301'),
              h.Attribute('text-anchor', 'middle'),
              h.Class('fill-signal font-mono font-medium'),
              h.Attribute('font-size', '18')
            ],
            ['capabilities']
          ),
          ...['250', '322'].map((y) =>
            h.circle([
              h.Attribute('cx', '200'),
              h.Attribute('cy', y),
              h.Attribute('r', '3'),
              h.Class('fill-signal')
            ])
          )
        ]
      ),
      node('d1', 8, 402, 64, 'D1'),
      node('durable-objects', 80, 402, 144, 'Durable Objects'),
      node('queues', 232, 402, 80, 'Queues'),
      node('email', 320, 402, 80, 'Email')
    ]
  )
}
