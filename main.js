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

uniform float     uTime;
uniform vec2      uResolution;
uniform sampler2D uTexture;
uniform bool      uHasCamera;
uniform float     uDispX;
uniform float     uDispY;
uniform float     uRingWidth;
uniform float     uSpeed;
uniform float     uDPR;

varying vec2 vUv;

#define PI 3.14159265359

vec2 rot45(vec2 p) {
  float c = 0.70710678;
  return vec2(c * p.x - c * p.y, c * p.x + c * p.y);
}
vec2 rot45inv(vec2 p) {
  float c = 0.70710678;
  return vec2(c * p.x + c * p.y, -c * p.x + c * p.y);
}

float circlePattern(vec2 centered) {
  float dist  = length(centered);
  // Continuous outward-expanding rings — no discrete triggers, no pulse
  // fract() wraps smoothly so new rings emerge from centre endlessly
  float phase = fract(dist * 1.5 - uTime * uSpeed);
  float sigma = max(uRingWidth * 0.38, 0.04);
  return exp(-pow((phase - 0.5) / sigma, 2.0));
}

// Snap px to block grid, return centered UV in aspect-correct space
vec2 snapCentered(vec2 px, float block, float aspect) {
  vec2 snap   = floor(px / block) * block + block * 0.5;
  vec2 snapUV = snap / uResolution;
  return (snapUV - 0.5) * vec2(aspect, 1.0);
}

// Two-layer blended pattern: axis-aligned + 45° rotated grid, screen blend
float dualPattern(vec2 px, float block, float aspect) {
  // Layer A: normal axis-aligned grid
  vec2  cA  = snapCentered(px, block, aspect);
  float patA = circlePattern(cA);

  // Layer B: 45°-rotated grid passing through vertices of base grid
  // Rotating around origin (not screen centre) keeps vertices aligned.
  // Block spacing must be block/√2 so grid lines land on base-grid corners.
  float blockB  = block * 0.70710678;
  vec2  pxRot   = rot45(px);
  vec2  snapRot = floor(pxRot / blockB) * blockB + blockB * 0.5;
  vec2  snapBack = rot45inv(snapRot);
  vec2  cB      = (snapBack / uResolution - 0.5) * vec2(aspect, 1.0);
  float patB    = circlePattern(cB);

  // Screen blend: bright where either layer is bright
  return 1.0 - (1.0 - patA) * (1.0 - patB);
}

void main() {
  vec2  px     = gl_FragCoord.xy;
  float aspect = uResolution.x / uResolution.y;
  float block  = 48.0 * uDPR;

  // ── Main area ─────────────────────────────────────────────────────────────
  float pat = dualPattern(px, block, aspect);

  if (uHasCamera) {
    // Radial displacement: black=inward, gray=none, white=outward — fully symmetric
    vec2 centered     = snapCentered(px, block, aspect);
    float r           = length(centered);
    vec2  dir         = r > 0.0001 ? centered / r : vec2(0.0);
    dir.x            /= aspect;
    float dispPat     = pat * 2.0 - 1.0; // remap [0,1] → [-1,1]
    // Fade displacement at edges to prevent stretching/clamping artifacts
    vec2  edgeFade    = smoothstep(0.0, 0.20, vUv) * smoothstep(1.0, 0.80, vUv);
    float fade        = edgeFade.x * edgeFade.y;
    vec2  disp        = vec2(dir.x * dispPat * uDispX, dir.y * dispPat * uDispY) * fade;
    // Subtle chromatic aberration: R/B offset slightly along displacement axis
    float cab         = 0.004;
    vec2  uvR         = clamp(vec2(1.0 - (vUv.x + disp.x + dir.x * cab), vUv.y + disp.y + dir.y * cab), 0.0, 1.0);
    vec2  uvG         = clamp(vec2(1.0 - (vUv.x + disp.x),               vUv.y + disp.y              ), 0.0, 1.0);
    vec2  uvB         = clamp(vec2(1.0 - (vUv.x + disp.x - dir.x * cab), vUv.y + disp.y - dir.y * cab), 0.0, 1.0);
    float cr          = texture2D(uTexture, uvR).r;
    float cg          = texture2D(uTexture, uvG).g;
    float cb          = texture2D(uTexture, uvB).b;
    gl_FragColor = vec4(cr, cg, cb, 1.0);
  } else {
    gl_FragColor = vec4(vec3(pat), 1.0);
  }
}`;

// ─── Camera ───────────────────────────────────────────────────────────────────

let videoTexture = null;

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1280 },
      height: { ideal: 720 },
    },
  });

  const video       = document.createElement('video');
  video.srcObject   = stream;
  video.playsInline = true;
  video.muted       = true;
  video.autoplay    = true;

  await new Promise((resolve, reject) => {
    video.oncanplay = resolve;
    video.onerror   = reject;
    video.play().catch(reject);
  });

  videoTexture           = new THREE.VideoTexture(video);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  uniforms.uTexture.value   = videoTexture;
  uniforms.uHasCamera.value = true;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uTime:       { value: 0 },
  uResolution: { value: new THREE.Vector2(
    window.innerWidth  * window.devicePixelRatio,
    window.innerHeight * window.devicePixelRatio,
  )},
  uTexture:    { value: new THREE.Texture() },
  uHasCamera:  { value: false },
  uDispX:      { value: 0.43 },
  uDispY:      { value: 0.276 },
  uRingWidth:  { value: 0.6 },
  uSpeed:      { value: 0.15 },
  uDPR:        { value: window.devicePixelRatio },
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
  uniforms.uDPR.value = window.devicePixelRatio;
});

// ─── Start camera, then begin render loop ─────────────────────────────────────

const t0 = performance.now();

function animate() {
  requestAnimationFrame(animate);
  uniforms.uTime.value = (performance.now() - t0) / 1000;
  if (videoTexture) videoTexture.needsUpdate = true;
  renderer.render(scene, camera);
}

const sliderX = document.getElementById('sliderX');
const sliderY = document.getElementById('sliderY');
const sliderW = document.getElementById('sliderW');
sliderX.addEventListener('input', () => { uniforms.uDispX.value = parseFloat(sliderX.value); document.getElementById('valX').textContent = sliderX.value; });
sliderY.addEventListener('input', () => { uniforms.uDispY.value = parseFloat(sliderY.value); document.getElementById('valY').textContent = sliderY.value; });
sliderW.addEventListener('input', () => { uniforms.uRingWidth.value = parseFloat(sliderW.value); document.getElementById('valW').textContent = sliderW.value; });
const sliderS = document.getElementById('sliderS');
sliderS.addEventListener('input', () => { uniforms.uSpeed.value = parseFloat(sliderS.value); document.getElementById('valS').textContent = sliderS.value; });

window.addEventListener('load', async () => {
  await startCamera();
  animate();
});
