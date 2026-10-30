import { Effect, Schema } from 'effect'
import createQrCode from 'qrcode-generator'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Graphic = Schema.Struct({ modules: Schema.Number, path: Schema.String })
export type Graphic = typeof Graphic.Type

// The encoder can reject oversized input. Keep the manual enrollment path available.
export const encode = Effect.fn('AccountSecurity.encodeEnrollmentQr')((uri: string) =>
  Effect.try({
    try: (): Graphic => {
      const code = createQrCode(0, 'L')
      // The package's Byte mode consumes Latin-1 code units. Supply UTF-8 bytes
      // explicitly without changing its global stringToBytes implementation.
      const bytes = Array.from(new TextEncoder().encode(uri), (byte) =>
        String.fromCharCode(byte)
      ).join('')
      code.addData(bytes, 'Byte')
      code.make()
      const modules = code.getModuleCount()
      const runs: Array<string> = []
      for (let row = 0; row < modules; row += 1) {
        let column = 0
        while (column < modules) {
          if (!code.isDark(row, column)) {
            column += 1
            continue
          }
          const start = column
          while (column < modules && code.isDark(row, column)) {
            column += 1
          }
          runs.push(`M${start} ${row}h${column - start}v1H${start}z`)
        }
      }
      return { modules, path: runs.join('') }
    },
    catch: () => 'QrEncodingFailed' as const
  }).pipe(Effect.catch(() => Effect.succeed(null)))
)

export function view<M>(graphic: Graphic, h: HtmlBuilder<M>): Html {
  const label = m.two_factor_qr_code()
  return h.figure(
    [h.AriaLabel(label), h.Class('shrink-0')],
    [
      h.svg(
        [
          h.Attribute('width', '144'),
          h.Attribute('height', '144'),
          h.Attribute('viewBox', `0 0 ${graphic.modules} ${graphic.modules}`),
          h.Attribute('shape-rendering', 'crispEdges'),
          h.Role('img'),
          h.AriaLabel(label)
        ],
        [
          // QR contrast is deliberately black on white, matching the former QRCodeSVG.
          h.path([
            // oxlint-disable-next-line starter/no-hex-color -- Barcode background preserves QRCodeSVG's optical white independently of UI theme tokens.
            h.Attribute('fill', '#ffffff'),
            h.Attribute('d', `M0 0h${graphic.modules}v${graphic.modules}H0z`)
          ]),
          h.path([
            // oxlint-disable-next-line starter/no-hex-color -- Barcode modules preserve QRCodeSVG's optical black independently of UI theme tokens.
            h.Attribute('fill', '#000000'),
            h.Attribute('d', graphic.path)
          ])
        ]
      ),
      h.figcaption([h.Class('sr-only')], [label])
    ]
  )
}
