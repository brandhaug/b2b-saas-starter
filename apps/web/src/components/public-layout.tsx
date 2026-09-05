import { type ReactNode, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BoxesIcon, MenuIcon } from 'lucide-react'
// The public layout is the one scope that still renders Newsreader (the
// landing hero and section headings), so its latin variable woff2 preloads
// here instead of in __root.tsx: auth screens and the workspace app never
// enter this layout and never pay for the font.
import newsreaderLatinWoff2 from '@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2?url'
import { SearchButton } from '@/components/command-palette'
import { GITHUB_URL } from '@/components/landing/github-url'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'
import { publicLinks } from '@/lib/content'

export function PublicLayout({ children }: { readonly children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  return (
    <div className="marketing flex min-h-dvh flex-col bg-background">
      {/* Rendered in the tree, hoisted to <head> by React 19 — see the import
          comment above. Deduped by href if the root ever preloads it again. */}
      <link
        rel="preload"
        href={newsreaderLatinWoff2}
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
      <a
        // oxlint-disable-next-line react-doctor/anchor-target-exists -- the target is owned by this layout's children: every public route renders its own <main id="main-content"> (routes/index.tsx, sign-in.tsx, pricing.tsx, …). The rule scans only the file declaring the link.
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary px-3 py-2 text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        {/* `gap-3` on the narrow bar: the wordmark is nowrap (P3), so the
            16px gaps pushed Sign in 8px past a 390px viewport. */}
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 md:gap-4">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger
              render={
                <Button variant="ghost" size="icon" className="md:hidden">
                  <MenuIcon className="size-5" />
                  <span className="sr-only">Open menu</span>
                </Button>
              }
            />
            <SheetContent side="left" className="flex flex-col gap-0">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
                <SheetDescription className="sr-only">Site navigation</SheetDescription>
              </SheetHeader>
              <nav aria-label="Site" className="flex flex-col gap-1 px-4 pb-4">
                {publicLinks.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setMobileNavOpen(false)}
                    className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                ))}
                <Button
                  render={<Link to="/sign-in" />}
                  onClick={() => setMobileNavOpen(false)}
                  className="mt-2 max-md:w-full"
                >
                  Sign in
                </Button>
              </nav>
            </SheetContent>
          </Sheet>
          <Link
            to="/"
            className="flex items-center gap-2 font-semibold whitespace-nowrap"
          >
            <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <BoxesIcon className="size-4" />
            </span>
            B2B SaaS Starter
          </Link>
          <nav aria-label="Site" className="ml-auto hidden items-center gap-1 md:flex">
            {publicLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <SearchButton />
          <Button nativeButton={false} render={<Link to="/sign-in" />}>
            Sign in
          </Button>
        </div>
      </header>
      {children}
      <footer className="mt-auto border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between">
          <span>B2B SaaS Starter for Cloudflare-first teams.</span>
          <div className="flex flex-wrap gap-4">
            <Link
              to="/privacy"
              className="py-2.5 underline-offset-4 hover:text-foreground hover:underline"
            >
              Privacy
            </Link>
            <Link
              to="/terms"
              className="py-2.5 underline-offset-4 hover:text-foreground hover:underline"
            >
              Terms
            </Link>
            {/* /changelog redirects to the repository's releases, so link
                there directly — the footer should not bounce through a
                redirect to leave the site. */}
            <a
              href={`${GITHUB_URL}/releases`}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 underline-offset-4 hover:text-foreground hover:underline"
            >
              Changelog
              <span className="sr-only"> (opens in new tab)</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
