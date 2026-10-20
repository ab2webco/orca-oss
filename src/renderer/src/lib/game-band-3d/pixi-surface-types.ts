// Why: pixi.js's own typings add a global `getContext('webgpu')` overload that breaks unrelated
// canvas mocks across the renderer, so tsc maps `pixi.js` here (config/tsconfig*.web.json paths)
// while Vite still bundles the real package. Only the surface the POC scene uses.
export type PointLike = { x: number; y: number; set(x: number, y?: number): void }

export type ScaleMode = 'nearest' | 'linear'

export type DestroyOptions = { children?: boolean }

export declare class Container {
  children: Container[]
  parent: Container | null
  position: PointLike
  scale: PointLike
  rotation: number
  tint: number
  alpha: number
  visible: boolean
  addChild<T extends Container>(...children: T[]): T
  removeChildren(): Container[]
  destroy(options?: DestroyOptions): void
}

export declare class TextureSource {
  scaleMode: ScaleMode
  destroy(): void
}

export declare class BufferImageSource extends TextureSource {
  constructor(options: {
    resource: Uint8Array
    width: number
    height: number
    scaleMode?: ScaleMode
  })
}

export declare class CanvasSource extends TextureSource {
  constructor(options: { resource: HTMLCanvasElement; scaleMode?: ScaleMode })
}

export declare class Texture {
  static readonly WHITE: Texture
  constructor(options: { source: TextureSource })
  source: TextureSource
  destroy(destroySource?: boolean): void
}

export declare class Sprite extends Container {
  constructor(texture?: Texture)
  texture: Texture
  anchor: PointLike
  width: number
  height: number
}

export type UniformStructure = { value: Float32Array | number; type: 'vec3<f32>' | 'f32' }

export declare class UniformGroup {
  constructor(structures: Record<string, UniformStructure>)
  uniforms: Record<string, Float32Array | number>
  update(): void
  destroy(): void
}

export declare class Geometry {
  constructor(options: {
    attributes: Record<string, Float32Array>
    indexBuffer?: Uint32Array | Uint16Array
  })
  destroy(destroyBuffers?: boolean): void
}

export declare class Shader {
  static from(options: {
    gl: { vertex: string; fragment: string }
    resources?: Record<string, UniformGroup>
  }): Shader
  destroy(destroyPrograms?: boolean): void
}

export declare class Mesh extends Container {
  constructor(options: { geometry: Geometry; shader: Shader })
  geometry: Geometry
}

export type WebGLRenderer = {
  gl: WebGL2RenderingContext
  resize(width: number, height: number, resolution?: number): void
  render(container: Container): void
}

export declare class Application {
  renderer: WebGLRenderer
  stage: Container
  init(options: {
    canvas: HTMLCanvasElement
    width: number
    height: number
    antialias: boolean
    autoStart: boolean
    preference: 'webgl' | 'webgpu'
  }): Promise<void>
  destroy(rendererOptions?: { removeView?: boolean }, options?: DestroyOptions): void
}
