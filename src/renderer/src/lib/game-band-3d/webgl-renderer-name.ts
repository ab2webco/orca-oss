/** UNMASKED_RENDERER_WEBGL: the only reliable way to tell SwiftShader from a real GPU. */
export const webglRendererNameOf = (
  gl: WebGLRenderingContext | WebGL2RenderingContext | null
): string | null => {
  if (gl === null) {
    return null
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const name: unknown = gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL)
  return typeof name === 'string' ? name : null
}
