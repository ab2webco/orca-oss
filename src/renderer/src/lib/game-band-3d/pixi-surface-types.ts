// Why: pixi.js's own typings add a global `getContext('webgpu')` overload that breaks unrelated
// canvas mocks across the renderer, so tsc maps `pixi.js` here (config/tsconfig*.web.json paths)
// while Vite still bundles the real package. Only the surface the POC scene uses.
export type PointLike = { x: number; y: number; set(x: number, y?: number): void }

export declare class Container {
  children: Container[]
  position: PointLike
  scale: PointLike
  rotation: number
  tint: number
  alpha: number
  visible: boolean
  addChild(...children: Container[]): Container
  removeChildren(): Container[]
  destroy(options?: { children?: boolean }): void
}

export declare class Graphics extends Container {
  moveTo(x: number, y: number): this
  lineTo(x: number, y: number): this
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): this
  closePath(): this
  rect(x: number, y: number, width: number, height: number): this
  roundRect(x: number, y: number, width: number, height: number, radius: number): this
  circle(x: number, y: number, radius: number): this
  poly(points: number[]): this
  fill(color: number): this
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
  destroy(rendererOptions?: { removeView?: boolean }, options?: { children?: boolean }): void
}
