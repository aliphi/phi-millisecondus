/**
 * vertex.glsl — reference copy (not loaded at runtime)
 *
 * The inline VERT constant in main.js is used instead, so all passes
 * (simple effects and fluid sim) share one vertex shader without a fetch.
 *
 * The mesh is a 2×2 PlaneGeometry rendered through an OrthographicCamera
 * that maps NDC (-1..1) directly to the viewport, so position is passed
 * through as-is and no projection matrix is needed.
 *
 * Outputs:
 *   vUv  — texture coordinates in [0,1] range, passed to the fragment shader
 */

precision highp float;

// Uniforms shared with the fragment shader (declared here if you need them
// in the vertex stage too — most effects only use them in the fragment stage).
uniform float uTime;
uniform vec2  uResolution;

varying vec2 vUv;

void main() {
  // uv comes from PlaneGeometry: (0,0) = bottom-left, (1,1) = top-right
  vUv = uv;

  // Position is already in clip space — no MVP transform required
  gl_Position = vec4(position, 1.0);
}
