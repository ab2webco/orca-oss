// sRGB transfer functions in GLSL, matching three's, for the libraries that light in linear space.
export const SRGB_GLSL = /* glsl */ `
vec3 toLinear(vec3 c) {
  return mix(c * 0.0773993808, pow(c * 0.9478672986 + 0.0521327014, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(vec3(0.0031308), c));
}`
