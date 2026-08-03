const logoLetters = [
  ['b-1', 'b'],
  ['e-1', 'e'],
  ['e-2', 'e'],
  ['s', 's'],
  ['o-1', 'o'],
  ['l', 'l'],
  ['o-2', 'o']
] as const

export function BeeSoloMark({ className = '' }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 126 126"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M40.3 64.4L61.3 76.5V100.8L40.3 113L19.3 100.8V76.5L40.3 64.4Z" />
      <path d="M84.7 13L105.7 25.2V49.5L84.7 61.6L63.7 49.5V25.2L84.7 13Z" />
      <path d="M40.3 13L61.3 25.1V49.4L40.3 61.6L19.3 49.4V25.1L40.3 13Z" />
      <path d="M84.7 64.4L105.7 76.6V100.9L84.7 113L63.7 100.9V76.6L84.7 64.4Z" />
    </svg>
  )
}

export function BeeSoloLogo({
  iconOnly = false,
  className = ''
}: {
  readonly iconOnly?: boolean
  readonly className?: string
}) {
  return (
    <span
      aria-label={iconOnly ? 'BeeSolo' : undefined}
      className={`beesolo-logo inline-flex items-center gap-2 ${className}`.trim()}
    >
      <BeeSoloMark className="size-8 shrink-0" />
      {iconOnly ? null : (
        <span className="inline-flex items-baseline text-2xl font-bold tracking-tighter">
          {logoLetters.map(([id, letter], index) => (
            <span
              className="beesolo-logo-letter inline-block"
              key={id}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {letter}
            </span>
          ))}
          <span
            className="beesolo-logo-dot inline-block"
            style={{ animationDelay: `${logoLetters.length * 50}ms` }}
          >
            .
          </span>
        </span>
      )}
    </span>
  )
}
