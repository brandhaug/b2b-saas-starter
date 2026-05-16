import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BoxesIcon, MenuIcon } from 'lucide-react'
import { SearchButton } from '@/components/command-palette'
import { ThemeToggle } from '@/components/theme-toggle'
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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
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
              <nav className="flex flex-col gap-1 px-4 pb-4">
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
                <Link
                  to="/sign-in"
                  onClick={() => setMobileNavOpen(false)}
                  className="mt-2 inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Sign in
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <BoxesIcon className="size-4" />
            </span>
            B2B SaaS Starter
          </Link>
          <nav className="ml-auto hidden items-center gap-1 md:flex">
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
          <ThemeToggle />
          <Link
            to="/sign-in"
            className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Sign in
          </Link>
        </div>
      </header>
      {children}
      <footer className="mt-auto border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between">
          <span>B2B SaaS Starter for Cloudflare-first teams.</span>
          <div className="flex gap-4">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/changelog">Changelog</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
