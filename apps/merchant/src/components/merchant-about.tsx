import { BeeSoloLogo, BeeSoloMark } from './beesolo-logo.tsx'

export function MerchantAbout() {
  return (
    <section aria-labelledby="merchant-about-title" className="mx-auto w-full max-w-sm">
      <div className="flex flex-col items-center px-4 pt-8 text-center md:pt-10">
        <BeeSoloMark className="size-12 text-foreground" />
        <h2 id="merchant-about-title" className="sr-only">
          About BeeSolo
        </h2>
        <div className="mt-5">
          <BeeSoloLogo />
        </div>
        <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
          Appointments, customers, services, and availability in one focused Merchant
          App.
        </p>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-border/70 bg-muted/35">
        <div className="px-4 py-4">
          <p className="text-sm font-medium text-foreground">Merchant App</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Built for the daily work of independent providers and small teams.
          </p>
        </div>
      </div>
    </section>
  )
}
