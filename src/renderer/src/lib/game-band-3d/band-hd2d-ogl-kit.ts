// OGL building blocks for the HD-2D band: tracked GPU resources, quads, textures, lit programs.
import { Geometry, Program, Texture, type OGLRenderingContext } from 'ogl'
import { FOG } from './hd2d-layout'
import { linearOf, type Hd2dLights } from './hd2d-lighting'
import type { SpriteImage } from './hd2d-world'
import { LIT_FRAGMENT, LIT_VERTEX } from './band-hd2d-ogl-shaders'

type Uniform<T> = { value: T }

/** One set of light and fog uniforms, shared by reference across every lit program. */
export type OglLightUniforms = {
  uHemiSky: Uniform<number[]>
  uHemiGround: Uniform<number[]>
  uHemiIntensity: Uniform<number>
  uSunColor: Uniform<number[]>
  uSunDir: Uniform<number[]>
  uFogColor: Uniform<number[]>
  uFogNear: Uniform<number>
  uFogFar: Uniform<number>
}

export const createLightUniforms = (): OglLightUniforms => ({
  uHemiSky: { value: [1, 1, 1] },
  uHemiGround: { value: [0, 0, 0] },
  uHemiIntensity: { value: 1 },
  uSunColor: { value: [1, 1, 1] },
  uSunDir: { value: [0, 1, 0] },
  uFogColor: { value: [1, 1, 1] },
  uFogNear: { value: FOG.near },
  uFogFar: { value: FOG.far }
})

export const applyLights = (uniforms: OglLightUniforms, lights: Hd2dLights): void => {
  uniforms.uHemiSky.value = [...linearOf(lights.hemiSky)]
  uniforms.uHemiGround.value = [...linearOf(lights.hemiGround)]
  uniforms.uHemiIntensity.value = lights.hemiIntensity
  uniforms.uSunColor.value = linearOf(lights.sunColor).map((c) => c * lights.sunIntensity)
  uniforms.uSunDir.value = [...lights.sunDirection]
}

export type LitLook = {
  tMap: Uniform<Texture>
  uTint: Uniform<number[]>
  uEmissive: Uniform<number[]>
  uRepeat: Uniform<number[]>
}

/** Every texture, geometry and program made through it, so one call frees them all. */
export const createGpuPool = (gl: OGLRenderingContext) => {
  const textures: Texture[] = []
  const geometries: Geometry[] = []
  const programs: Program[] = []

  const geometry = (attributes: ConstructorParameters<typeof Geometry>[1]): Geometry => {
    const made = new Geometry(gl, attributes)
    geometries.push(made)
    return made
  }

  const adopt = <T extends Geometry>(made: T): T => {
    geometries.push(made)
    return made
  }

  /** Nearest-sampled pixel art; rows stay top-first, so v = 0 is the image's top. */
  const pixelTexture = (image: SpriteImage): Texture => {
    const made = new Texture(gl, {
      image: new Uint8Array(image.rgba.buffer, image.rgba.byteOffset, image.rgba.length),
      width: image.width,
      height: image.height,
      generateMipmaps: false,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
      flipY: false,
      unpackAlignment: 1
    })
    textures.push(made)
    return made
  }

  const canvasTexture = (canvas: HTMLCanvasElement, repeat = false): Texture => {
    const made = new Texture(gl, {
      image: canvas,
      flipY: false,
      generateMipmaps: repeat,
      minFilter: repeat ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
      wrapS: repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE,
      wrapT: repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE,
      anisotropy: repeat ? 4 : 0
    })
    textures.push(made)
    return made
  }

  const program = (options: ConstructorParameters<typeof Program>[1]): Program => {
    const made = new Program(gl, options)
    programs.push(made)
    return made
  }

  const lit = (
    light: OglLightUniforms,
    map: Texture,
    repeat: number[] = [1, 1]
  ): { program: Program; look: LitLook } => {
    const look: LitLook = {
      tMap: { value: map },
      uTint: { value: [1, 1, 1] },
      uEmissive: { value: [0, 0, 0] },
      uRepeat: { value: repeat }
    }
    const made = program({
      vertex: LIT_VERTEX,
      fragment: LIT_FRAGMENT,
      uniforms: { ...light, ...look },
      cullFace: false
    })
    return { program: made, look }
  }

  /** Rectangles facing +z, each `[centreX, bottomY, z, width, height]`, uv top-first. */
  const quads = (rects: readonly (readonly [number, number, number, number, number])[]) => {
    const position = new Float32Array(rects.length * 12)
    const normal = new Float32Array(rects.length * 12)
    const uv = new Float32Array(rects.length * 8)
    const index = new Uint32Array(rects.length * 6)
    rects.forEach(([x, y, z, w, h], i) => {
      const l = x - w / 2
      const r = x + w / 2
      position.set([l, y + h, z, r, y + h, z, l, y, z, r, y, z], i * 12)
      normal.set([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], i * 12)
      uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8)
      const v = i * 4
      index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6)
    })
    return geometry({
      position: { size: 3, data: position },
      normal: { size: 3, data: normal },
      uv: { size: 2, data: uv },
      index: { data: index }
    })
  }

  const free = (): void => {
    for (const one of textures) {
      gl.deleteTexture(one.texture)
    }
    for (const one of geometries) {
      one.remove()
    }
    for (const one of programs) {
      one.remove()
    }
    textures.length = 0
    geometries.length = 0
    programs.length = 0
  }

  return { geometry, adopt, pixelTexture, canvasTexture, program, lit, quads, free }
}

export type GpuPool = ReturnType<typeof createGpuPool>
