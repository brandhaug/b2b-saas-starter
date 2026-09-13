import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { LIGHT_RAYS_FRAGMENT_SHADER } from './light-rays-shader'

// Spell UI's shader, rendered directly without a scene-graph dependency.
function LightRays({ origin = 'bottom' }: { readonly origin?: 'top' | 'bottom' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvasRef.current
    if (!element) {
      return
    }
    const canvas = element
    let dispose = mountLightRays(canvas)
    function restore() {
      dispose?.()
      dispose = mountLightRays(canvas)
    }
    element.addEventListener('webglcontextrestored', restore)
    return () => {
      element.removeEventListener('webglcontextrestored', restore)
      dispose?.()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 size-full text-primary opacity-30',
        origin === 'bottom' && 'rotate-180'
      )}
    />
  )
}

function mountLightRays(canvas: HTMLCanvasElement) {
  const context3d = canvas.getContext('webgl', { alpha: true, antialias: false })
  if (!context3d) {
    return
  }

  const gl = context3d
  const vertex = gl.createShader(gl.VERTEX_SHADER)
  const fragment = gl.createShader(gl.FRAGMENT_SHADER)
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  let contextLost = false
  function dispose() {
    // Lost contexts invalidate their resources; deleting them after restoration
    // would pass stale handles to the new context.
    if (contextLost) {
      return
    }
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
  }
  if (!vertex || !fragment) {
    dispose()
    return
  }

  gl.shaderSource(
    vertex,
    `attribute vec2 position;
    void main() { gl_Position = vec4(position, 0.0, 1.0); }`
  )
  gl.shaderSource(fragment, LIGHT_RAYS_FRAGMENT_SHADER)
  gl.compileShader(vertex)
  gl.compileShader(fragment)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    dispose()
    return
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW
  )
  const position = gl.getAttribLocation(program, 'position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

  // Resolve the semantic CSS color through a 2D canvas, including OKLCH.
  const swatch = document.createElement('canvas')
  swatch.width = 1
  swatch.height = 1
  const context = swatch.getContext('2d')
  if (!context) {
    dispose()
    return
  }
  context.fillStyle = getComputedStyle(canvas).color
  context.fillRect(0, 0, 1, 1)
  const color = context.getImageData(0, 0, 1, 1).data
  const rgba = [(color[0] ?? 0) / 255, (color[1] ?? 0) / 255, (color[2] ?? 0) / 255, 1]
  gl.uniform4fv(gl.getUniformLocation(program, 'u_colors'), [...rgba, ...rgba])
  gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), 0.065)
  gl.uniform1f(gl.getUniformLocation(program, 'u_rays'), 0.096)
  gl.uniform1f(gl.getUniformLocation(program, 'u_reach'), 0.08)
  const timeUniform = gl.getUniformLocation(program, 'u_time')
  const resolutionUniform = gl.getUniformLocation(program, 'u_resolution')
  const ray1Uniform = gl.getUniformLocation(program, 'u_rayPos1')
  const ray2Uniform = gl.getUniformLocation(program, 'u_rayPos2')
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let visible = false
  let frame = 0
  let lastTime = 0
  let elapsed = 0

  function draw() {
    gl.uniform1f(timeUniform, elapsed)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  function animate(time: number) {
    elapsed += lastTime === 0 ? 0 : (time - lastTime) / 2000
    lastTime = time
    draw()
    frame = requestAnimationFrame(animate)
  }
  function syncAnimation() {
    cancelAnimationFrame(frame)
    lastTime = 0
    if (visible && !document.hidden && !gl.isContextLost()) {
      draw()
      if (!reducedMotion.matches) {
        frame = requestAnimationFrame(animate)
      }
    }
  }
  function resize() {
    // One physical pixel per CSS pixel keeps the full-width shader bounded.
    canvas.width = Math.max(1, Math.round(canvas.clientWidth))
    canvas.height = Math.max(1, Math.round(canvas.clientHeight))
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(resolutionUniform, canvas.width, canvas.height)
    gl.uniform2f(ray1Uniform, canvas.width * 0.65, canvas.height * -0.4)
    gl.uniform2f(ray2Uniform, canvas.width * 0.67, canvas.height * -0.5)
    syncAnimation()
  }
  const resizeObserver = new ResizeObserver(resize)
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false
    syncAnimation()
  })
  resizeObserver.observe(canvas)
  intersectionObserver.observe(canvas)
  reducedMotion.addEventListener('change', syncAnimation)
  document.addEventListener('visibilitychange', syncAnimation)
  function onContextLost(event: Event) {
    event.preventDefault()
    contextLost = true
    syncAnimation()
  }
  canvas.addEventListener('webglcontextlost', onContextLost)
  resize()

  return () => {
    cancelAnimationFrame(frame)
    resizeObserver.disconnect()
    intersectionObserver.disconnect()
    reducedMotion.removeEventListener('change', syncAnimation)
    document.removeEventListener('visibilitychange', syncAnimation)
    canvas.removeEventListener('webglcontextlost', onContextLost)
    dispose()
  }
}

export { LightRays }
