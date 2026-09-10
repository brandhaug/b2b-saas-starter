import { type SVGProps } from 'react'

/**
 * The Google mark as one monochrome path on `currentColor`, so the sign-in
 * buttons stay on the token system: brand marks are not in lucide, and the
 * multicolour official mark would be the only raw color on the auth screens.
 * Same 24-unit viewBox as the other marks here, so one `size-*` class sizes
 * any of them identically.
 */
export function GoogleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M12.07 2.9c2.5 0 4.74.86 6.51 2.56l-2.75 2.13a5.63 5.63 0 0 0-3.76-1.35 6.04 6.04 0 0 0-5.7 4.17L3.22 7.98A9.09 9.09 0 0 1 12.07 2.9Zm8.85 4.71a9.15 9.15 0 0 1 .12 10.18c-1.17 1.8-3.03 3.15-5.31 3.65a9.3 9.3 0 0 1-6.75-1.13 8.85 8.85 0 0 1-3.39-3.9l3.15-2.43a5.82 5.82 0 0 0 6.09 4.28 4.65 4.65 0 0 0 2.91-1.65c.28-.33.5-.7.63-1.1h-5.28v-3.4h8.49c.18.84.3 1.71.34 2.58Z" />
    </svg>
  )
}
