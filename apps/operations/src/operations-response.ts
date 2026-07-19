const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]!
  )

const html = (title: string, body: string, status = 200): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>@font-face{font-family:'Geist Variable';src:url('/assets/geist.woff2') format('woff2');font-weight:100 900;font-style:normal;font-display:swap}@font-face{font-family:'Geist Mono Variable';src:url('/assets/geist-mono.woff2') format('woff2');font-weight:100 900;font-style:normal;font-display:swap}:root{color-scheme:light dark;--background:#fcfcfc;--foreground:#424242;--card:#fff;--border:#e2e8f0;--primary:#3b82f6;--primary-foreground:#fff;--secondary:#f1f5f9;--secondary-foreground:#475569;--muted:#f8fafc;--ring:#3b82f6}@media(prefers-color-scheme:dark){:root{--background:#1e1e1e;--foreground:#e5e5e5;--card:#2d2d2d;--border:#494949;--secondary:#2d2d2d;--secondary-foreground:#e5e5e5;--muted:#2d2d2d}}body{font:400 .9375rem/1.55 'Geist Variable',sans-serif;background:var(--background);color:var(--foreground);max-width:80rem;margin:4.5rem auto;padding:0 1.5rem}main{border:1px solid var(--border);padding:2rem;background:var(--card)}h1,h2,h3{font-weight:600;letter-spacing:-.015em}label,input,button{display:block;width:100%;box-sizing:border-box}input,button{min-height:2.25rem;margin:.5rem 0 1.5rem;padding:.75rem;border-radius:.375rem}input{color:var(--foreground);background:var(--card);border:1px solid var(--border)}input[type=checkbox]{display:inline;width:auto;min-height:auto;margin:.25rem .5rem .25rem 0;padding:0}button{cursor:pointer;color:var(--secondary-foreground);background:var(--secondary);border:0;font-weight:500}button:first-of-type{color:var(--primary-foreground);background:var(--primary)}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid var(--ring);outline-offset:2px}a{color:var(--primary)}code{font-family:'Geist Mono Variable',monospace;font-feature-settings:'tnum';background:var(--muted);padding:.125rem .25rem}table{width:100%;border-collapse:collapse}th,td{border:1px solid var(--border);padding:.75rem;text-align:left;vertical-align:top}td form{margin-bottom:1rem}</style></head><body><main>${body}</main></body></html>`,
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer'
      }
    }
  )

const redirect = (location: string, cookies: readonly string[] = []): Response => {
  const headers = new Headers({ location, 'cache-control': 'no-store' })
  cookies.forEach((cookie) => headers.append('set-cookie', cookie))
  return new Response(null, { status: 303, headers })
}

export { escapeHtml, html, redirect }
