export function MerchantHomeHero({ className = '' }: { readonly className?: string }) {
  return (
    <div aria-hidden className={`merchant-home-hero ${className}`}>
      <div className="merchant-home-hero-image" />
      <div className="merchant-home-hero-fade" />
      <div className="merchant-home-grain merchant-home-hero-grain" />
    </div>
  )
}

export function MerchantHomeAtmosphere({ showHero = true }: { showHero?: boolean }) {
  return (
    <>
      <div aria-hidden className="merchant-home-grain md:rounded-3xl" />
      {showHero ? <MerchantHomeHero /> : null}
    </>
  )
}
