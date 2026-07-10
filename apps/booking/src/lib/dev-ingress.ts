/** Map Public Site Booking traffic to the Vite paths it can serve locally. */
export const bookingVitePath = (pathname: string): string => {
  // StyleX's development stylesheet is the one Vite virtual endpoint that
  // ignores Vite's `base`. Keep the browser URL under Booking's public asset
  // prefix, then remove it only on this private Vite hop.
  if (pathname === '/_booking/virtual:stylex.css') return '/virtual:stylex.css'
  return pathname.startsWith('/_booking/') ? pathname : `/_booking${pathname}`
}
