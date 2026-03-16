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

varying vec2 vUv;

#define PI 3.14159265359

vec2 rot45(vec2 p) {
  float c = 0.70710678; // cos(45°) = sin(45°)
  return vec2(c * p.x - c * p.y, c * p.x + c * p.y);
}

float circlePattern(vec2 centered) {
  float dist   = length(centered);
  float result = 0.0;
  for (int i = 0; i < 4; i++) {
    float t      = fract(uTime * 0.13 + float(i) * 0.25);
    float radius = t * 1.15;
    float alpha  = sin(t * PI);
    // Expanding ring
    float sigma  = max(radius * 0.13, 0.03);
    float ring   = exp(-pow((dist - radius) / sigma, 2.0));
    // Origin burst: each wave launches from the centre, bright at birth, fades as it expands
    float burst  = (1.0 - t) * exp(-dist * dist / max(0.002, radius * radius * 0.08));
    result = max(result, max(ring, burst) * alpha);
  }
  return result;
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

  // Layer B: 45°-rotated grid — rotate px around screen centre, snap, rotate back
  vec2 centre   = uResolution * 0.5;
  vec2 pxRot    = rot45(px - centre) + centre;
  vec2 snapRot  = floor(pxRot / block) * block + block * 0.5;
  // Rotate the snapped centre back to screen space
  vec2 snapBack = rot45(-(snapRot - centre)) + centre + centre - centre;
  // Simpler: just use the rotated snap centre directly for the pattern distance
  vec2 snapRotUV = snapRot / uResolution;
  // But we need the distance in the *original* (unrotated) aspect-correct space,
  // so rotate the centred coord back by -45°
  vec2 cB_rot   = (snapRotUV - 0.5) * vec2(aspect, 1.0);
  vec2 cB       = vec2(cB_rot.x * 0.70710678 + cB_rot.y * 0.70710678,
                      -cB_rot.x * 0.70710678 + cB_rot.y * 0.70710678);
  float patB = circlePattern(cB);

  // Screen blend: bright where either layer is bright
  return 1.0 - (1.0 - patA) * (1.0 - patB);
}

void main() {
  vec2  px     = gl_FragCoord.xy;
  float aspect = uResolution.x / uResolution.y;
  float block  = 48.0;

  // ── Corner preview (top-left, 180px square) ───────────────────────────────
  float prevPx  = 180.0;
  float border  = 2.0;
  bool inCorner = px.x < prevPx && px.y > uResolution.y - prevPx;

  if (inCorner) {
    if (px.x < border || px.y > uResolution.y - border ||
        px.x > prevPx - border || px.y < uResolution.y - prevPx + border) {
      gl_FragColor = vec4(0.45, 0.45, 0.45, 1.0);
      return;
    }
    // Scale preview coords to match fullscreen pattern
    float scale  = uResolution.y / prevPx;
    vec2  previewPx = vec2(px.x, px.y - (uResolution.y - prevPx)) * scale;
    float pat    = dualPattern(previewPx, block, aspect);
    gl_FragColor = vec4(vec3(pat), 1.0);
    return;
  }

  // ── Main area ─────────────────────────────────────────────────────────────
  float pat = dualPattern(px, block, aspect);

  if (uHasCamera) {
    // Displacement direction: tangential (perpendicular to radial = lateral swirl)
    vec2 centered     = snapCentered(px, block, aspect);
    float r           = length(centered);
    // Rotate radial 90° → tangential, pixels slide along rings not away from centre
    vec2  dir         = r > 0.0001 ? vec2(-centered.y, centered.x) / r : vec2(0.0);
    dir.x            /= aspect;
    vec2 camUV        = vUv + dir * pat * 0.12;
    camUV             = clamp(camUV, 0.0, 1.0);
    camUV.x           = 1.0 - camUV.x;
    vec4  cam         = texture2D(uTexture, camUV);
    float luma        = dot(cam.rgb, vec3(0.299, 0.587, 0.114));
    gl_FragColor = vec4(vec3(luma), 1.0);
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

// ─── Auto-start camera after page is fully loaded ─────────────────────────────

window.addEventListener('load', startCamera);

// ─── Render loop ──────────────────────────────────────────────────────────────

const t0 = performance.now();

(function animate() {
  requestAnimationFrame(animate);
  uniforms.uTime.value = (performance.now() - t0) / 1000;
  if (videoTexture) videoTexture.needsUpdate = true;
  renderer.render(scene, camera);
})();
