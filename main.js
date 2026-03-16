/**
 * Persian Mirrorworks — main.js
 *
 * Recreates the TouchDesigner network:
 *
 *   ramp → transform+flip → 4-way mirror composite (res1+res2)
 *   → LFO-pulsed crossfade (cross1)
 *   → displace live camera
 *   → mono + luma levels
 *
 * All collapsed into a single fragment shader pass.
 * No ping-pong buffers needed — the displacement field is
 * purely mathematical (polar fold + ring oscillators).
 */

import * as THREE from 'three';

// ─── Shaders ──────────────────────────────────────────────────────────────────

const VERT = /* glsl */`
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;

uniform sampler2D uTexture;    // live camera feed
uniform float     uTime;       // elapsed seconds
uniform vec2      uResolution; // canvas physical pixels

varying vec2 vUv;

#define PI 3.14159265358979324

// ── Helpers ───────────────────────────────────────────────────────────────────

// Triangle wave — produces the sharp V-shaped ridges that read as
// "crooked angled lines" when the fold seams intersect across sectors.
float tri(float x) {
  return abs(fract(x) * 2.0 - 1.0);
}

// ── Main ──────────────────────────────────────────────────────────────────────
void main() {
  float aspect = uResolution.x / uResolution.y;

  // Centre-origin, aspect-corrected coordinates
  vec2 uv = vUv - 0.5;
  uv.x *= aspect;

  float r     = length(uv);
  float theta = atan(uv.y, uv.x);

  // ── Slow rotation (animates the whole lattice) ─────────────────────────────
  theta += uTime * 0.06;

  // ── 8-fold mirror fold (Persian 8-point star / shamse geometry) ───────────
  // Fold the full circle into one canonical sector, mirror across its bisector.
  // This creates the angular seam lines — the "crooked" edges of each mirror facet.
  const float N        = 8.0;
  const float SECTOR   = PI / N;          // width of one sector (= PI/8)
  float fold = mod(theta, SECTOR * 2.0);
  if (fold > SECTOR) fold = SECTOR * 2.0 - fold;
  // fold ∈ [0, SECTOR] — position within the canonical sector

  // Normalised position inside the sector [0,1]
  float sPos = fold / SECTOR;

  // Angular "crooked lines": triangle wave on sPos creates sharp V-ridges
  // at the fold seams. Squaring sharpens them further.
  float angLines = pow(1.0 - tri(sPos), 2.5);

  // ── Two concentric ring oscillators (res1 + res2 in TD) ───────────────────
  // Different frequencies + opposing time directions give the layered look.
  float ring1 = sin(r * 22.0 - uTime * 0.38);
  float ring2 = sin(r * 13.0 + uTime * 0.22);
  float rings  = ring1 * 0.62 + ring2 * 0.38;

  // ── Combine: angular lattice modulates ring amplitude ─────────────────────
  // Where fold seams cross, angLines → 0 so the field pinches to zero,
  // creating the characteristic thin "crooked" bright/dark lines of mirrorwork.
  float field = rings * angLines;

  // ── LFO pulse (lfo1 → math1 → cross1 in TD, values ~0.25–0.31) ───────────
  float lfo      = 0.5 + 0.5 * sin(uTime * 0.48);
  float strength = mix(0.045, 0.13, lfo);

  // ── Displacement vector (radial + small tangential twist) ─────────────────
  vec2 radDir  = uv / (r + 1e-5);
  vec2 tangDir = vec2(-radDir.y, radDir.x);
  vec2 disp    = (radDir * 0.72 + tangDir * 0.28) * field * strength;
  disp.x      /= aspect;   // undo aspect correction before UV sampling

  // ── Sample camera at displaced coordinates ────────────────────────────────
  vec2 sampleUv = clamp(vUv + disp, 0.001, 0.999);
  vec3 col      = texture2D(uTexture, sampleUv).rgb;

  // ── Monochrome + luma levels (mono1 + lumalevel1 in TD) ───────────────────
  float luma = dot(col, vec3(0.299, 0.587, 0.114));

  // Black-point lift + contrast crush — mirrors TD's lumalevel node
  luma = clamp((luma - 0.14) * 2.1, 0.0, 1.0);

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
    video: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });

  const video = document.createElement('video');
  video.srcObject  = stream;
  video.playsInline = true;
  video.muted      = true;
  video.autoplay   = true;

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

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // VideoTexture
  const texture = new THREE.VideoTexture(video);
  texture.minFilter  = THREE.LinearFilter;
  texture.magFilter  = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  // Uniforms
  const uniforms = {
    uTexture:    { value: texture },
    uTime:       { value: 0 },
    uResolution: { value: new THREE.Vector2(
      window.innerWidth  * window.devicePixelRatio,
      window.innerHeight * window.devicePixelRatio,
    )},
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader:   VERT,
    fragmentShader: FRAG,
  });

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    uniforms.uResolution.value.set(
      window.innerWidth  * window.devicePixelRatio,
      window.innerHeight * window.devicePixelRatio,
    );
  });

  const startTime = performance.now();

  function animate() {
    requestAnimationFrame(animate);
    texture.needsUpdate  = true;
    uniforms.uTime.value = (performance.now() - startTime) / 1000;
    renderer.render(scene, camera);
  }

  animate();
}

main();
