// GLSL for the OGL band scene: one lambert-with-fog program and one point program.
export const VERTEX = /* glsl */ `
attribute vec3 position;
attribute vec3 normal;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
varying vec3 vNormal;
varying float vDepth;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`

export const FRAGMENT = /* glsl */ `
precision mediump float;
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform vec3 uFog;
uniform float uSun;
varying vec3 vNormal;
varying float vDepth;
void main() {
  float light = 0.35 + uSun * max(dot(vNormal, normalize(vec3(-0.4, 0.8, 0.6))), 0.0);
  vec3 lit = uColor * light + uEmissive;
  float fog = smoothstep(9.0, 26.0, vDepth);
  gl_FragColor = vec4(mix(lit, uFog, fog), 1.0);
}`

export const POINT_VERTEX = /* glsl */ `
attribute vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uSize;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize;
}`

export const POINT_FRAGMENT = /* glsl */ `
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor, uOpacity); }`
