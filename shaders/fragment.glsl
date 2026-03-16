/**
 * fragment.glsl — reference / starter template
 *
 * NOTE: Runtime effects are now defined in the EFFECTS array in main.js.
 * This file is kept as a standalone reference and is no longer loaded at
 * runtime.  Copy/paste a void main(){} body into the EFFECTS array to add
 * a new effect to the cycling button.
 *
 * Available uniforms
 * ──────────────────
 *   uniform sampler2D uTexture;    // live camera feed
 *   uniform float     uTime;       // elapsed seconds since page load
 *   uniform vec2      uResolution; // canvas size in physical pixels
 *                                  // (already * devicePixelRatio)
 *
 * Interpolated input from vertex shader
 * ──────────────────────────────────────
 *   varying vec2 vUv;  // (0,0) bottom-left → (1,1) top-right
 *
 * Fragment coordinate (built-in)
 * ──────────────────────────────
 *   gl_FragCoord.xy — pixel position in physical pixels, origin bottom-left
 *                     Normalise to [0,1]: vec2 uv = gl_FragCoord.xy / uResolution;
 *
 * Output
 * ──────
 *   gl_FragColor — vec4(r, g, b, a) in [0,1]
 */

precision mediump float;

uniform sampler2D uTexture;
uniform float     uTime;
uniform vec2      uResolution;

varying vec2 vUv;

void main() {
  // ── Passthrough: display the raw camera feed ──────────────────────────────
  vec4 color = texture2D(uTexture, vUv);

  gl_FragColor = color;

  // ── Example effects (uncomment one block at a time) ──────────────────────

  // Greyscale
  // float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  // gl_FragColor = vec4(vec3(luma), 1.0);

  // Inverted colours
  // gl_FragColor = vec4(1.0 - color.rgb, 1.0);

  // Chromatic aberration
  // float amount = 0.005 + 0.003 * sin(uTime);
  // float r = texture2D(uTexture, vUv + vec2( amount, 0.0)).r;
  // float g = texture2D(uTexture, vUv).g;
  // float b = texture2D(uTexture, vUv - vec2( amount, 0.0)).b;
  // gl_FragColor = vec4(r, g, b, 1.0);

  // Pixelate
  // float pixels = 80.0;
  // vec2 snap = floor(vUv * pixels) / pixels;
  // gl_FragColor = texture2D(uTexture, snap);

  // Scanlines
  // float line = step(0.5, fract(gl_FragCoord.y / 3.0));
  // gl_FragColor = vec4(color.rgb * (0.6 + 0.4 * line), 1.0);
}
