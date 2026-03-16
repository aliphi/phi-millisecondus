/**
 * Persian Mirrorworks — main.js
 *
 * Two pixelated radial B&W grids (polar checkerboards):
 *   Grid 1 — normal orientation
 *   Grid 2 — rotated 45° on top
 *   Combined (multiply) → displacement map  [black=0, white=1]
 *
 * The composite rotates 0→360° continuously.
 * A corner preview shows the live displacement pattern.
 */

import * as THREE from 'three';

const VERT = /* glsl */`
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;

uniform sampler2D uTexture;
uniform float     uTime;
uniform vec2      uResolution;

varying vec2 vUv;

#define PI     3.14159265358979324
#define TWO_PI 6.28318530717958648

// ── Helpers ───────────────────────────────────────────────────────────────────

vec2 rot2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Hard pixelated polar checker cell → returns exactly 0.0 or 1.0.
// Divides the plane into concentric ring bands and angular sectors;
// alternates like a checkerboard on that polar grid.
float polarCell(vec2 p, float rings, float segs) {
  float r     = length(p);
  float theta = atan(p.y, p.x);          // [-PI, PI]

  float rBand = mod(floor(r * rings), 2.0);
  float tBand = mod(floor(mod(theta + PI, TWO_PI) / TWO_PI * segs), 2.0);

  return mod(rBand + tBand, 2.0);         // XOR → polar checkerboard
}

// Combined two-grid displacement map (sampled at arbitrary UV)
float dispMap(vec2 p, float rings, float segs, float rot) {
  float g1 = polarCell(rot2(p, rot),              rings, segs);
  float g2 = polarCell(rot2(p, rot + PI * 0.25),  rings, segs); // 45° offset
  return g1 * g2;   // multiply: white only where BOTH cells are white
}

// ── Main ──────────────────────────────────────────────────────────────────────
void main() {
  float aspect = uResolution.x / uResolution.y;

  // Full rotation every 20 s
  float rot = uTime * TWO_PI / 20.0;

  float rings = 8.0;
  float segs  = 14.0;

  // ── Corner preview (top-left, 190 × 190 physical pixels) ─────────────────
  // vUv (0,0) = bottom-left in GL; top-left screen corner = high px.y
  float prevPx = 190.0;
  float border  = 2.0;
  vec2  px      = vUv * uResolution;
  float topEdge = uResolution.y;

  bool inPreviewOuter = px.x < prevPx + border
                     && px.y > topEdge - prevPx - border;
  bool inPreviewInner = px.x >= border && px.x < prevPx
                     && px.y > topEdge - prevPx && px.y <= topEdge - border;

  if (inPreviewOuter) {
    if (!inPreviewInner) {
      // Thin gray border
      gl_FragColor = vec4(vec3(0.38), 1.0);
      return;
    }
    // Remap into [-0.5, 0.5] centred coords for the pattern
    vec2 pp = vec2(
      (px.x - border) / (prevPx - border * 2.0) - 0.5,
      ((topEdge - px.y) - border) / (prevPx - border * 2.0) - 0.5
    );
    float val = dispMap(pp, rings, segs, rot);
    gl_FragColor = vec4(vec3(val), 1.0);
    return;
  }

  // ── Full-screen displacement ───────────────────────────────────────────────
  vec2 uv = vUv - 0.5;
  uv.x   *= aspect;

  float dMap = dispMap(uv, rings, segs, rot);   // 0.0 or 1.0

  // Slow LFO on strength  (mirrors TD's cross1 + lfo1)
  float lfo      = 0.5 + 0.5 * sin(uTime * 0.48);
  float strength = mix(0.04, 0.13, lfo);

  // Displacement direction: radial + slight tangential twist
  // (dispMap - 0.5) centres around zero → white cells push out, black pull in
  vec2 radDir  = uv / (length(uv) + 1e-5);
  vec2 tanDir  = vec2(-radDir.y, radDir.x);
  vec2 disp    = (radDir * 0.78 + tanDir * 0.22) * (dMap - 0.5) * strength;
  disp.x      /= aspect;

  // Sample camera
  vec2 sampleUv = clamp(vUv + disp, 0.001, 0.999);
  vec3 col      = texture2D(uTexture, sampleUv).rgb;

  // Monochrome + contrast
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  luma = clamp((luma - 0.1) * 2.1, 0.0, 1.0);

  gl_FragColor = vec4(vec3(luma), 1.0);
}`;

// ─── UI helpers ───────────────────────────────────────────────────────────────

const overlay = document.getElementById('overlay');
function showOverlay(msg) { overlay.textContent = msg; overlay.classList.remove('hidden'); }
function hideOverlay()    { overlay.classList.add('hidden'); }

// ─── Camera ───────────────────────────────────────────────────────────────────

async function openCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  await new Promise((resolve, reject) => {
    video.oncanplay = resolve;
    video.onerror   = reject;
    video.play().catch(reject);
  });
  return video;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  let video;
  try {
    showOverlay('Requesting camera…');
    video = await openCamera();
  } catch (err) {
    showOverlay(`Camera error:\n${err.message}`);
    return;
  }
  hideOverlay();

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const texture = new THREE.VideoTexture(video);
  texture.minFilter  = THREE.LinearFilter;
  texture.magFilter  = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  const uniforms = {
    uTexture:    { value: texture },
    uTime:       { value: 0 },
    uResolution: { value: new THREE.Vector2(
      window.innerWidth  * window.devicePixelRatio,
      window.innerHeight * window.devicePixelRatio,
    )},
  };

  scene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG }),
  ));

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    uniforms.uResolution.value.set(
      window.innerWidth  * window.devicePixelRatio,
      window.innerHeight * window.devicePixelRatio,
    );
  });

  const t0 = performance.now();
  function animate() {
    requestAnimationFrame(animate);
    texture.needsUpdate  = true;
    uniforms.uTime.value = (performance.now() - t0) / 1000;
    renderer.render(scene, camera);
  }
  animate();
}

main();
