import { type Plugin } from 'vite-plus'

const forbidden = [
  /\.effects\.[cm]?[jt]sx?$/,
  /\/src\/http\/(?:handlers\/|(?:transport|routes|page-loader|csrf)\.[cm]?[jt]s$)/,
  /\/src\/lib\/(?:request-context|auth-runtime|observability|capabilities)\.[cm]?[jt]s$/,
  /\/packages\/capabilities\/src\/(?:runtime|layers)\.ts$/,
  /\/packages\/email\/src\/templates\//,
  /\/node_modules\/(?:react|react-dom|react-email|@react-email\/[^/]+|@tanstack\/react-[^/]+)\//,
  /^cloudflare:/
]

/** Inspect resolved module identities rather than strings in documentation or schemas. */
export function forbiddenBrowserModule(id: string): boolean {
  const path = id.replaceAll('\\', '/').split('?')[0] ?? id
  return forbidden.some((pattern) => pattern.test(path))
}

export function browserBoundary(): Plugin {
  return {
    name: 'starter:browser-boundary',
    generateBundle(_options, bundle) {
      if (this.environment.name !== 'client') {
        return
      }
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') {
          continue
        }
        for (const id of Object.keys(output.modules)) {
          if (forbiddenBrowserModule(id)) {
            this.error(`Server or React module shipped in ${output.fileName}: ${id}`)
          }
        }
      }
    }
  }
}
