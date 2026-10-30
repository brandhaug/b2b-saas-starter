import { LIGHT_RAYS_FRAGMENT_SHADER } from '@/components/landing/light-rays-shader'

/** The existing shader renderer, with its lifetime owned by Foldkit. */
export function mountLightRays(canvas: HTMLCanvasElement): () => void {
  let dispose = acquire(canvas)
  function restore() {
    dispose()
    dispose = acquire(canvas)
  }
  canvas.addEventListener('webglcontextrestored', restore)
  return () => {
    canvas.removeEventListener('webglcontextrestored', restore)
    dispose()
  }
}

function acquire(canvas: HTMLCanvasElement): () => void {
  const contextGl = canvas.getContext('webgl', { alpha: true, antialias: false })
  if (!contextGl) {
    return () => {
      /* No graphics resources were acquired. */
    }
  }
  const gl = contextGl
  const vertex = gl.createShader(gl.VERTEX_SHADER)
  const fragment = gl.createShader(gl.FRAGMENT_SHADER)
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  let contextLost = false
  function dispose() {
    if (contextLost) {
      return
    }
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
  }
  if (!vertex || !fragment || gl.isContextLost()) {
    dispose()
    return () => {
      /* Acquisition already released its resources. */
    }
  }
  gl.shaderSource(
    vertex,
    'attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }'
  )
  gl.shaderSource(fragment, LIGHT_RAYS_FRAGMENT_SHADER)
  gl.compileShader(vertex)
  gl.compileShader(fragment)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    dispose()
    return () => {
      /* Acquisition already released its resources. */
    }
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
  const swatch = document.createElement('canvas')
  swatch.width = 1
  swatch.height = 1
  const context = swatch.getContext('2d')
  if (!context) {
    dispose()
    return () => {
      /* Acquisition already released its resources. */
    }
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
  function sync() {
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
    canvas.width = Math.max(1, Math.round(canvas.clientWidth))
    canvas.height = Math.max(1, Math.round(canvas.clientHeight))
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(resolutionUniform, canvas.width, canvas.height)
    gl.uniform2f(ray1Uniform, canvas.width * 0.65, canvas.height * -0.4)
    gl.uniform2f(ray2Uniform, canvas.width * 0.67, canvas.height * -0.5)
    sync()
  }
  const resizeObserver = new ResizeObserver(resize)
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false
    sync()
  })
  resizeObserver.observe(canvas)
  intersectionObserver.observe(canvas)
  reducedMotion.addEventListener('change', sync)
  document.addEventListener('visibilitychange', sync)
  function lost(event: Event) {
    event.preventDefault()
    contextLost = true
    sync()
  }
  canvas.addEventListener('webglcontextlost', lost)
  resize()
  return () => {
    cancelAnimationFrame(frame)
    resizeObserver.disconnect()
    intersectionObserver.disconnect()
    reducedMotion.removeEventListener('change', sync)
    document.removeEventListener('visibilitychange', sync)
    canvas.removeEventListener('webglcontextlost', lost)
    dispose()
  }
}
