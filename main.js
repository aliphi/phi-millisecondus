/**
 * Camera Shader — main.js
 *
 * Flow:
 *   1. Fetch shaders/vertex.glsl from disk
 *   2. Open the camera via getUserMedia (works on RPi /dev/video0 and mobile)
 *   3. Feed the camera stream into a Three.js VideoTexture
 *   4. Render the texture onto a fullscreen quad with a ShaderMaterial
 *   5. A cycling button lets you switch between built-in effects at runtime
 *
 * Adding a new effect: append an entry to the EFFECTS array below.
 */

import * as THREE from 'three';

// ─── Shared GLSL header ───────────────────────────────────────────────────────
// Prepended to every fragment shader so each effect only needs void main(){}.

const GLSL_HEAD = /* glsl */`
precision highp float;

// Live camera frame
uniform sampler2D uTexture;

// Seconds since page load — use for animations
uniform float uTime;

// Canvas size in physical pixels (width * devicePixelRatio, height * devicePixelRatio)
uniform vec2 uResolution;

// Texture coords: (0,0) = bottom-left, (1,1) = top-right
varying vec2 vUv;
`;

// ─── Effects ──────────────────────────────────────────────────────────────────
// Each entry: { name: string, frag: string }
// frag is the body after the shared header — just write void main(){}.

const EFFECTS = [
  {
    name: 'Passthrough',
    frag: GLSL_HEAD + /* glsl */`
void main() {
  gl_FragColor = texture2D(uTexture, vUv);
}`,
  },

  {
    name: 'Greyscale',
    frag: GLSL_HEAD + /* glsl */`
void main() {
  vec3 c = texture2D(uTexture, vUv).rgb;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(vec3(luma), 1.0);
}`,
  },

  {
    name: 'Invert',
    frag: GLSL_HEAD + /* glsl */`
void main() {
  vec4 c = texture2D(uTexture, vUv);
  gl_FragColor = vec4(1.0 - c.rgb, 1.0);
}`,
  },

  {
    name: 'Chromatic Aberration',
    frag: GLSL_HEAD + /* glsl */`
void main() {
  // Aberration amount pulses gently over time
  float amount = 0.006 + 0.004 * sin(uTime * 1.3);

  float r = texture2D(uTexture, vUv + vec2( amount, 0.0)).r;
  float g = texture2D(uTexture, vUv                    ).g;
  float b = texture2D(uTexture, vUv - vec2( amount, 0.0)).b;

  gl_FragColor = vec4(r, g, b, 1.0);
}`,
  },

  {
    name: 'Pixelate',
    frag: GLSL_HEAD + /* glsl */`
void main() {
  // Block size in pixels — increase for chunkier look
  float blockSize = 18.0;

  // Convert vUv to pixel coords, snap to block grid, convert back
  vec2 pixelCoord = vUv * uResolution;
  vec2 snapped    = floor(pixelCoord / blockSize) * blockSize + blockSize * 0.5;
  vec2 snapUv     = snapped / uResolution;

  gl_FragColor = texture2D(uTexture, snapUv);
}`,
  },

  {
    name: 'Scanlines',
    frag: GLSL_HEAD + /* glsl */`
void main() {
  vec4 c = texture2D(uTexture, vUv);

  // Horizontal line every 3 physical pixels
  float line = step(0.5, fract(gl_FragCoord.y / 3.0));
  vec3 rgb   = c.rgb * (0.55 + 0.45 * line);

  gl_FragColor = vec4(rgb, 1.0);
}`,
  },

  {
    name: 'Edge Detect',
    frag: GLSL_HEAD + /* glsl */`
// Sobel edge detection on luminance
float luma(vec2 uv) {
  return dot(texture2D(uTexture, uv).rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 px = 1.0 / uResolution; // one-pixel step in UV space

  // 3×3 Sobel kernel samples
  float tl = luma(vUv + px * vec2(-1.0,  1.0));
  float tc = luma(vUv + px * vec2( 0.0,  1.0));
  float tr = luma(vUv + px * vec2( 1.0,  1.0));
  float ml = luma(vUv + px * vec2(-1.0,  0.0));
  float mr = luma(vUv + px * vec2( 1.0,  0.0));
  float bl = luma(vUv + px * vec2(-1.0, -1.0));
  float bc = luma(vUv + px * vec2( 0.0, -1.0));
  float br = luma(vUv + px * vec2( 1.0, -1.0));

  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
  float edge = clamp(sqrt(gx*gx + gy*gy) * 4.0, 0.0, 1.0);

  gl_FragColor = vec4(vec3(edge), 1.0);
}`,
  },

  {
    name: 'Duotone',
    frag: GLSL_HEAD + /* glsl */`
void main() {
  vec3 c = texture2D(uTexture, vUv).rgb;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));

  // Cycle hue over time for the two tone colours
  float t = uTime * 0.25;
  vec3 shadow   = vec3(0.05, 0.02, 0.18 + 0.1 * sin(t));
  vec3 highlight = vec3(1.0, 0.75 + 0.2 * sin(t + 1.5), 0.1);

  gl_FragColor = vec4(mix(shadow, highlight, luma), 1.0);
}`,
  },

  {
    name: 'Glitch',
    frag: GLSL_HEAD + /* glsl */`
// Pseudo-random hash
float rand(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  // Slice the image into horizontal bands and randomly offset some of them
  float sliceHeight = 0.04;
  float band = floor(vUv.y / sliceHeight);

  // Only glitch a fraction of bands, and change per ~0.1s window
  float timeSlot = floor(uTime * 10.0);
  float r = rand(band * 1.7 + timeSlot * 13.3);
  float active = step(0.92, r); // ~8 % of bands at any moment

  float shift = (rand(band + timeSlot) - 0.5) * 0.08 * active;
  vec2 uv = vec2(fract(vUv.x + shift), vUv.y);

  vec4 c = texture2D(uTexture, uv);

  // Colour split on glitching bands
  float cr = texture2D(uTexture, uv + vec2(0.015 * active, 0.0)).r;
  float cb = texture2D(uTexture, uv - vec2(0.015 * active, 0.0)).b;

  gl_FragColor = vec4(cr, c.g, cb, 1.0);
}`,
  },
];

// ─── UI helpers ──────────────────────────────────────────────────────────────

const overlay = document.getElementById('overlay');

function showOverlay(msg) {
  overlay.textContent = msg;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

// ─── Shader loading ───────────────────────────────────────────────────────────

async function loadText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${path}`);
  return res.text();
}

// ─── Camera ──────────────────────────────────────────────────────────────────

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
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;

  await new Promise((resolve, reject) => {
    video.oncanplay = resolve;
    video.onerror  = reject;
    video.play().catch(reject);
  });

  return video;
}

// ─── Effect switcher UI ───────────────────────────────────────────────────────

function buildEffectUI(material) {
  let current = 0;

  // Toast label (top-centre, fades out)
  const toast = document.createElement('div');
  toast.id = 'effect-toast';
  document.body.appendChild(toast);

  let toastTimer = null;
  function showToast(name) {
    toast.textContent = name;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1400);
  }

  // Button (bottom-centre)
  const btn = document.createElement('button');
  btn.id = 'effect-btn';
  document.body.appendChild(btn);

  function apply(index) {
    current = index;
    const effect = EFFECTS[current];
    material.fragmentShader = effect.frag;
    material.needsUpdate = true;
    btn.textContent = `${effect.name}  ›`;
    showToast(effect.name);
  }

  btn.addEventListener('click', () => apply((current + 1) % EFFECTS.length));

  // Keyboard: Space / ArrowRight → next,  ArrowLeft → previous
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      apply((current + 1) % EFFECTS.length);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      apply((current - 1 + EFFECTS.length) % EFFECTS.length);
    }
  });

  apply(0); // initialise with first effect
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  // Load only the vertex shader from disk (fragment shaders are inline above)
  let vertSrc;
  try {
    vertSrc = await loadText('shaders/vertex.glsl');
  } catch (err) {
    showOverlay(
      `Failed to load vertex shader:\n${err.message}\n\n` +
      `If opening as file://, add --allow-file-access-from-files\n` +
      `to your Chromium flags (see README).`
    );
    return;
  }

  // Open camera
  let video;
  try {
    showOverlay('Requesting camera…');
    video = await openCamera();
  } catch (err) {
    showOverlay(`Camera error:\n${err.message}`);
    return;
  }

  hideOverlay();

  // Three.js renderer
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // VideoTexture
  const texture = new THREE.VideoTexture(video);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  // Uniforms — see GLSL_HEAD for documentation
  const uniforms = {
    uTexture:    { value: texture },
    uTime:       { value: 0.0 },
    uResolution: { value: new THREE.Vector2(
      window.innerWidth  * window.devicePixelRatio,
      window.innerHeight * window.devicePixelRatio,
    )},
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader:   vertSrc,
    fragmentShader: EFFECTS[0].frag, // overwritten immediately by buildEffectUI
  });

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  // Build the switcher button (also sets the initial effect)
  buildEffectUI(material);

  // Resize
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    uniforms.uResolution.value.set(
      window.innerWidth  * window.devicePixelRatio,
      window.innerHeight * window.devicePixelRatio,
    );
  });

  // Render loop
  let startTime = performance.now();

  function animate() {
    requestAnimationFrame(animate);
    texture.needsUpdate = true;
    uniforms.uTime.value = (performance.now() - startTime) / 1000;
    renderer.render(scene, camera);
  }

  animate();
}

main();
