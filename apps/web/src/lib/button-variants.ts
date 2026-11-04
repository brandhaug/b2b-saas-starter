import { cva } from 'class-variance-authority'

const outlineAppearance =
  'bg-input/30 border-input hover:bg-input/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground'
const ghostAppearance =
  'hover:bg-muted/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground'
const defaultSpacing =
  'gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2'

export const buttonVariants = cva(
  "ui-pressable focus-visible:border-ring aria-invalid:ring-destructive/40 aria-invalid:border-destructive/50 rounded-md border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-1 [&_svg:not([class*='size-'])]:size-4 inline-flex items-center justify-center whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none group/button select-none",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
        outline: outlineAppearance,
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost: ghostAppearance,
        destructive:
          'bg-destructive/20 hover:bg-destructive/30 focus-visible:ring-destructive text-destructive focus-visible:border-destructive',
        link: 'text-primary underline-offset-4 hover:underline',
        'outline-muted': [outlineAppearance, 'text-muted-foreground'],
        dashed: [outlineAppearance, 'border-dashed'],
        sidebar:
          'border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
        'ghost-muted': [ghostAppearance, 'text-muted-foreground']
      },
      size: {
        default: ['h-9 max-md:h-11', defaultSpacing],
        xs: "h-8 max-md:h-11 gap-1 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        lg: 'h-11 gap-1.5 px-3 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        icon: 'size-9 max-md:size-11',
        'icon-xs': "size-8 max-md:size-11 [&_svg:not([class*='size-'])]:size-3",
        'icon-lg': 'size-11',
        flexible: [defaultSpacing, 'h-auto min-h-9 py-2 max-md:h-auto max-md:min-h-11'],
        row: [
          defaultSpacing,
          'h-auto min-h-11 max-md:h-11 justify-start py-2 text-left whitespace-normal'
        ],
        'row-lg': [defaultSpacing, 'h-auto min-h-11 justify-start py-3 max-md:h-auto'],
        inline: 'h-auto p-0 max-md:h-11 gap-1.5',
        'link-row': 'h-9 max-md:h-11 justify-start p-0 gap-1.5',
        compact: 'h-7 max-md:h-10 border-0 px-2 gap-1',
        touch: [defaultSpacing, 'min-h-11 h-9 max-md:h-11']
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)
