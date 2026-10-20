// GLSL for the OGL HD-2D band: three's Lambert + hemisphere + linear fog, rewritten by hand.
import { SRGB_GLSL as COLOR } from './hd2d-glsl'

const LIGHT = /* glsl */ `
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform float uHemiIntensity;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
vec3 lambert(vec3 diffuse, vec3 n) {
  float w = 0.5 * n.y + 0.5;
  vec3 irradiance = mix(uHemiGround, uHemiSky, w) * uHemiIntensity + uSunColor * max(dot(n, uSunDir), 0.0);
  return diffuse * irradiance * 0.3183098862;
}
vec3 fogged(vec3 color, float depth) {
  return mix(color, uFogColor, smoothstep(uFogNear, uFogFar, depth));
}`

export const RIDGE_VERTEX = /* glsl */ `
attribute vec3 position;
attribute vec3 normal;
attribute vec3 color;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
varying vec3 vNormal;
varying vec3 vColor;
varying float vDepth;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`

export const RIDGE_FRAGMENT = /* glsl */ `
precision highp float;
${COLOR}
${LIGHT}
varying vec3 vNormal;
varying vec3 vColor;
varying float vDepth;
void main() {
  gl_FragColor = vec4(toSrgb(fogged(lambert(vColor, normalize(vNormal)), vDepth)), 1.0);
}`

export const LIT_VERTEX = /* glsl */ `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec2 uRepeat;
varying vec3 vNormal;
varying vec2 vUv;
varying float vDepth;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv * uRepeat;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`

/** Textured Lambert; pixel art discards below half alpha like three's alphaTest. */
export const LIT_FRAGMENT = /* glsl */ `
precision highp float;
${COLOR}
${LIGHT}
uniform sampler2D tMap;
uniform vec3 uTint;
uniform vec3 uEmissive;
varying vec3 vNormal;
varying vec2 vUv;
varying float vDepth;
void main() {
  vec4 texel = texture2D(tMap, vUv);
  if (texel.a < 0.5) discard;
  vec3 lit = lambert(toLinear(texel.rgb) * uTint, normalize(vNormal)) + uEmissive;
  gl_FragColor = vec4(toSrgb(fogged(lit, vDepth)), 1.0);
}`

/** A full-screen triangle at the far plane: it only fills what nothing else drew. */
export const SKY_VERTEX = /* glsl */ `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  gl_Position = vec4(position, 0.99999, 1.0);
}`

export const FLAT_VERTEX = /* glsl */ `
attribute vec3 position;
attribute vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

export const FLAT_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tMap;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tMap, vUv); }`

/** A soft dark ellipse on the ground, standing in for a shadow map. */
export const BLOB_FRAGMENT = /* glsl */ `
precision highp float;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  gl_FragColor = vec4(0.0, 0.0, 0.0, (1.0 - smoothstep(0.35, 1.0, r)) * uOpacity);
}`

/** three's PointsMaterial: square points shrinking with depth, fogged. */
export const POINT_VERTEX = /* glsl */ `
attribute vec3 position;
attribute vec3 color;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uSize;
uniform float uScale;
varying vec3 vColor;
varying float vDepth;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_PointSize = uSize * (uScale / vDepth);
  gl_Position = projectionMatrix * mv;
}`

export const POINT_FRAGMENT = /* glsl */ `
precision highp float;
${COLOR}
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec3 vColor;
varying float vDepth;
void main() {
  gl_FragColor = vec4(toSrgb(mix(vColor, uFogColor, smoothstep(uFogNear, uFogFar, vDepth))), 1.0);
}`
