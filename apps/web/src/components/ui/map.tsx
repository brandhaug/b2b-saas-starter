import MapLibreGL, { type MarkerOptions } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Loader2, Locate, Maximize, Minus, Plus } from 'lucide-react'
import {
  createContext,
  type AriaAttributes,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

const defaultStyles = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
}

type Theme = 'light' | 'dark'

interface MapContextValue {
  readonly isLoaded: boolean
  readonly map: MapLibreGL.Map | null
  readonly resolvedTheme: Theme
}

const MapContext = createContext<MapContextValue | null>(null)

function useMap() {
  const context = useContext(MapContext)
  if (!context) throw new Error('useMap must be used within a Map component')
  return context
}

type MapStyleOption = string | MapLibreGL.StyleSpecification

type MapProps = {
  readonly 'aria-hidden'?: AriaAttributes['aria-hidden']
  readonly children?: ReactNode
  readonly className?: string
  readonly loading?: boolean
  readonly ref?: Ref<MapLibreGL.Map>
  readonly styles?: { readonly light?: MapStyleOption; readonly dark?: MapStyleOption }
  readonly theme?: Theme
} & Omit<MapLibreGL.MapOptions, 'container' | 'style'>

function DefaultLoader() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-xs">
      <div className="flex gap-1">
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
      </div>
    </div>
  )
}

function MapComponent({
  'aria-hidden': ariaHidden,
  children,
  className,
  loading = false,
  ref,
  styles,
  theme = 'dark',
  ...options
}: MapProps) {
  const mapRef = useRef<MapLibreGL.Map | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [map, setMap] = useState<MapLibreGL.Map | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const mapStyle = styles?.[theme] ?? defaultStyles[theme]
  const styleRef = useRef(mapStyle)
  const appliedStyleRef = useRef<MapStyleOption | null>(null)
  styleRef.current = mapStyle

  useImperativeHandle(ref, () => map as MapLibreGL.Map, [map])

  const setContainer = useCallback((container: HTMLDivElement | null) => {
    if (!container) {
      cleanupRef.current?.()
      cleanupRef.current = null
      return
    }
    if (mapRef.current || typeof window.WebGLRenderingContext === 'undefined') return

    const instance = new MapLibreGL.Map({
      attributionControl: { compact: true },
      container,
      renderWorldCopies: false,
      style: styleRef.current,
      ...optionsRef.current
    })
    appliedStyleRef.current = styleRef.current
    const handleLoad = () => setIsLoaded(true)
    let resizeFrame: number | null = null
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(([entry]) => {
            if (
              !entry ||
              entry.contentRect.height === 0 ||
              entry.contentRect.width === 0
            )
              return
            if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
            resizeFrame = requestAnimationFrame(() => instance.resize())
          })

    instance.on('load', handleLoad)
    resizeObserver?.observe(container)
    mapRef.current = instance
    setMap(instance)

    cleanupRef.current = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      resizeObserver?.disconnect()
      instance.off('load', handleLoad)
      instance.remove()
      mapRef.current = null
      appliedStyleRef.current = null
      setMap(null)
      setIsLoaded(false)
    }
  }, [])

  useEffect(() => {
    if (!map || appliedStyleRef.current === mapStyle) return
    appliedStyleRef.current = mapStyle
    map.setStyle(mapStyle, { diff: true })
  }, [map, mapStyle])

  const context = useMemo(
    () => ({ isLoaded, map, resolvedTheme: theme }),
    [isLoaded, map, theme]
  )

  return (
    <MapContext.Provider value={context}>
      <div
        aria-hidden={ariaHidden}
        className={cn('relative h-full w-full', className)}
        ref={setContainer}
      >
        {(!isLoaded || loading) && <DefaultLoader />}
        {map ? children : null}
      </div>
    </MapContext.Provider>
  )
}

interface MarkerContextValue {
  readonly marker: MapLibreGL.Marker
}

const MarkerContext = createContext<MarkerContextValue | null>(null)

type MapMarkerProps = {
  readonly children: ReactNode
  readonly latitude: number
  readonly longitude: number
} & Omit<MarkerOptions, 'element'>

function MapMarker({ children, latitude, longitude, ...options }: MapMarkerProps) {
  const { map } = useMap()
  const [marker] = useState(
    () =>
      new MapLibreGL.Marker({
        ...options,
        element: document.createElement('div')
      })
  )

  useEffect(() => {
    if (!map) return
    marker.setLngLat([longitude, latitude]).addTo(map)
    return () => {
      marker.remove()
    }
  }, [latitude, longitude, map, marker])

  return <MarkerContext.Provider value={{ marker }}>{children}</MarkerContext.Provider>
}

function MarkerContent({
  children,
  className
}: {
  readonly children?: ReactNode
  readonly className?: string
}) {
  const context = useContext(MarkerContext)
  if (!context) throw new Error('MarkerContent must be used within MapMarker')
  return createPortal(
    <div className={cn('relative cursor-pointer', className)}>
      {children ?? (
        <div className="size-4 rounded-full border-2 border-white bg-blue-500 shadow-lg" />
      )}
    </div>,
    context.marker.getElement()
  )
}

interface MapControlsProps {
  readonly className?: string
  readonly controls?: {
    readonly compass?: boolean
    readonly fullscreen?: boolean
    readonly locate?: boolean
    readonly zoom?: boolean
  }
  readonly position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}

const controlPositionClasses = {
  'top-left': 'top-2 left-2',
  'top-right': 'top-2 right-2',
  'bottom-left': 'bottom-2 left-2',
  'bottom-right': 'right-2 bottom-10'
}

function ControlButton({
  children,
  disabled = false,
  label,
  onClick
}: {
  readonly children: ReactNode
  readonly disabled?: boolean
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      className="flex size-8 items-center justify-center transition-all hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

function ControlGroup({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-background shadow-sm [&>button:not(:last-child)]:border-b [&>button:not(:last-child)]:border-border">
      {children}
    </div>
  )
}

function MapControls({
  className,
  controls,
  position = 'bottom-right'
}: MapControlsProps) {
  const { map } = useMap()
  const [locating, setLocating] = useState(false)
  const visible = {
    zoom: true,
    compass: false,
    locate: false,
    fullscreen: false,
    ...controls
  }

  return (
    <div
      className={cn(
        'absolute z-10 flex flex-col gap-1.5',
        controlPositionClasses[position],
        className
      )}
    >
      {visible.zoom ? (
        <ControlGroup>
          <ControlButton label="Zoom in" onClick={() => map?.zoomTo(map.getZoom() + 1)}>
            <Plus className="size-4" />
          </ControlButton>
          <ControlButton
            label="Zoom out"
            onClick={() => map?.zoomTo(map.getZoom() - 1)}
          >
            <Minus className="size-4" />
          </ControlButton>
        </ControlGroup>
      ) : null}
      {visible.compass ? (
        <ControlGroup>
          <ControlButton
            label="Reset bearing to north"
            onClick={() => map?.resetNorthPitch()}
          >
            <span className="text-xs font-bold">N</span>
          </ControlButton>
        </ControlGroup>
      ) : null}
      {visible.locate ? (
        <ControlGroup>
          <ControlButton
            disabled={locating}
            label="Find my location"
            onClick={() => {
              setLocating(true)
              navigator.geolocation?.getCurrentPosition(
                ({ coords }) => {
                  map?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 14 })
                  setLocating(false)
                },
                () => setLocating(false)
              )
            }}
          >
            {locating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Locate className="size-4" />
            )}
          </ControlButton>
        </ControlGroup>
      ) : null}
      {visible.fullscreen ? (
        <ControlGroup>
          <ControlButton
            label="Toggle fullscreen"
            onClick={() => {
              const container = map?.getContainer()
              if (document.fullscreenElement) void document.exitFullscreen()
              else void container?.requestFullscreen()
            }}
          >
            <Maximize className="size-4" />
          </ControlButton>
        </ControlGroup>
      ) : null}
    </div>
  )
}

export { MapComponent as Map, MapControls, MapMarker, MarkerContent, useMap }
