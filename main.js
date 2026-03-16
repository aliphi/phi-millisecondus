/**
 * Camera Shader — main.js
 *
 * Fluid dynamics displacement applied to the live camera feed.
 *
 *   ┌──────────────┐     ┌──────────────┐
 *   │ copy pass    │     │ motion pass  │
 *   │ cam→rtCamCurr│────▶│ curr vs prev │──▶ rtMotion
 *   └──────────────┘     └──────────────┘
 *                                              │
 *   ┌────────────────────────────────────────┐ │
 *   │ wave pass  (3-buffer rotation, no R/W  │◀┘
 *   │ hazard: read A+B, write T, rotate)     │
 *   └────────────────────────────────────────┘
 *                │
 *   ┌────────────▼──────────────────────────────┐
 *   │ display: gradient(wave) → UV displacement  │──▶ screen
 *   └────────────────────────────────────────────┘
 */

import * as THREE from 'three';

// ─── Vertex shader (all passes) ───────────────────────────────────────────────
const VERT = /* glsl */`
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`;

// ─── Fluid dynamics shaders ───────────────────────────────────────────────────

// Copy: blit any texture to a render target at sim resolution
const COPY_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTexture;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTexture, vUv);
}`;

// Motion: luminance difference between consecutive camera frames → [0,1]
const MOTION_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uCurrent;   // camera frame this tick
uniform sampler2D uPrevious;  // camera frame last tick
varying vec2 vUv;
void main() {
  vec3 curr = texture2D(uCurrent,  vUv).rgb;
  vec3 prev = texture2D(uPrevious, vUv).rgb;
  float diff = length(curr - prev);
  float motion = smoothstep(0.02, 0.2, diff);
  gl_FragColor = vec4(motion, 0.0, 0.0, 1.0);
}`;

// Wave: discrete wave equation with motion as source term (3-buffer ping-pong)
//   next = 2·curr - prev + α·∇²curr      (α = 0.25 → CFL-stable)
const WAVE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uWaveCurr;  // height field at t
uniform sampler2D uWavePrev;  // height field at t-1
uniform sampler2D uMotion;    // motion magnitude [0,1]
uniform vec2      uSimRes;    // simulation grid size
varying vec2 vUv;

void main() {
  vec2 px = 1.0 / uSimRes;

  float curr = texture2D(uWaveCurr, vUv).r;
  float prev = texture2D(uWavePrev, vUv).r;

  // 5-point Laplacian
  float n = texture2D(uWaveCurr, vUv + vec2(0.0,  px.y)).r;
  float s = texture2D(uWaveCurr, vUv + vec2(0.0, -px.y)).r;
  float e = texture2D(uWaveCurr, vUv + vec2( px.x, 0.0)).r;
  float w = texture2D(uWaveCurr, vUv + vec2(-px.x, 0.0)).r;

  float wave = 2.0 * curr - prev + 0.25 * (n + s + e + w - 4.0 * curr);

  // Damping — raise toward 1.0 for longer-lived ripples
  wave *= 0.991;

  // Inject motion as a height impulse
  float motion = texture2D(uMotion, vUv).r;
  wave += motion * 0.9;

  gl_FragColor = vec4(clamp(wave, -2.0, 2.0), 0.0, 0.0, 1.0);
}`;

// Display: displace camera UVs using the wave gradient + subtle chromatic split
const FLUID_DISP_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTexture;    // live camera feed (full resolution)
uniform sampler2D uFluid;      // wave height field
uniform vec2      uResolution; // canvas physical pixels
uniform vec2      uSimRes;     // simulation grid size
uniform float     uTime;
varying vec2 vUv;

void main() {
  vec2 px = 1.0 / uSimRes;

  // Central-difference gradient → displacement vector
  float gx = texture2D(uFluid, vUv + vec2(px.x, 0.0)).r
           - texture2D(uFluid, vUv - vec2(px.x, 0.0)).r;
  float gy = texture2D(uFluid, vUv + vec2(0.0, px.y)).r
           - texture2D(uFluid, vUv - vec2(0.0, px.y)).r;

  vec2 disp = vec2(gx, gy) * 0.12;

  // Subtle chromatic split along the displacement axis
  float split = length(disp) * 1.5;
  float r = texture2D(uTexture, vUv + disp + vec2(split, 0.0)).r;
  float g = texture2D(uTexture, vUv + disp                   ).g;
  float b = texture2D(uTexture, vUv + disp - vec2(split, 0.0)).b;

  gl_FragColor = vec4(r, g, b, 1.0);
}`;

// ─── FluidSim ─────────────────────────────────────────────────────────────────

class FluidSim {
  constructor(renderer) {
    this._renderer = renderer;
    this._simRes = new THREE.Vector2(256, 256);

    this._scene  = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quad   = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this._scene.add(this._quad);

    this._initTargets();
    this._initMaterials();
  }

  _makeRT() {
    return new THREE.WebGLRenderTarget(this._simRes.x, this._simRes.y, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
      type:      THREE.HalfFloatType,
    });
  }

  _initTargets() {
    this._rtCamCurr = this._makeRT();
    this._rtCamPrev = this._makeRT();
    this._rtMotion  = this._makeRT();
    // 3 wave buffers — write target is never the same RT as either read target
    this._rtWaveA   = this._makeRT(); // current state (t)
    this._rtWaveB   = this._makeRT(); // previous state (t-1)
    this._rtWaveT   = this._makeRT(); // temp write target (rotated each frame)
  }

  _mat(frag, uniforms) {
    return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms });
  }

  _initMaterials() {
    this._copyMat = this._mat(COPY_FRAG, {
      uTexture: { value: null },
    });

    this._motionMat = this._mat(MOTION_FRAG, {
      uCurrent:  { value: null },
      uPrevious: { value: null },
    });

    this._waveMat = this._mat(WAVE_FRAG, {
      uWaveCurr: { value: null },
      uWavePrev: { value: null },
      uMotion:   { value: null },
      uSimRes:   { value: this._simRes },
    });

    this._dispMat = this._mat(FLUID_DISP_FRAG, {
      uTexture:    { value: null },
      uFluid:      { value: null },
      uResolution: { value: new THREE.Vector2() },
      uSimRes:     { value: this._simRes },
      uTime:       { value: 0 },
    });
  }

  _pass(material, target) {
    this._quad.material = material;
    this._renderer.setRenderTarget(target);
    this._renderer.render(this._scene, this._camera);
  }

  reset() {
    const prev = this._renderer.getRenderTarget();
    [this._rtWaveA, this._rtWaveB, this._rtWaveT, this._rtMotion].forEach(rt => {
      this._renderer.setRenderTarget(rt);
      this._renderer.clear();
    });
    this._renderer.setRenderTarget(prev);
  }

  update(cameraTexture) {
    // 1. Capture camera frame at sim resolution
    this._copyMat.uniforms.uTexture.value = cameraTexture;
    this._pass(this._copyMat, this._rtCamCurr);

    // 2. Motion detection
    this._motionMat.uniforms.uCurrent.value  = this._rtCamCurr.texture;
    this._motionMat.uniforms.uPrevious.value = this._rtCamPrev.texture;
    this._pass(this._motionMat, this._rtMotion);

    // 3. Wave step — read A+B, write T, then rotate so A is always current
    this._waveMat.uniforms.uWaveCurr.value = this._rtWaveA.texture;
    this._waveMat.uniforms.uWavePrev.value = this._rtWaveB.texture;
    this._waveMat.uniforms.uMotion.value   = this._rtMotion.texture;
    this._pass(this._waveMat, this._rtWaveT);
    [this._rtWaveA, this._rtWaveB, this._rtWaveT] =
      [this._rtWaveT, this._rtWaveA, this._rtWaveB];

    // 4. Advance camera buffer
    [this._rtCamCurr, this._rtCamPrev] = [this._rtCamPrev, this._rtCamCurr];
  }

  display(cameraTexture, elapsedTime, resolution) {
    this._dispMat.uniforms.uTexture.value    = cameraTexture;
    this._dispMat.uniforms.uFluid.value      = this._rtWaveA.texture;
    this._dispMat.uniforms.uTime.value       = elapsedTime;
    this._dispMat.uniforms.uResolution.value.copy(resolution);
    this._pass(this._dispMat, null);
  }

  dispose() {
    [this._rtCamCurr, this._rtCamPrev, this._rtMotion,
     this._rtWaveA, this._rtWaveB, this._rtWaveT].forEach(rt => rt.dispose());
  }
}

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

  const texture = new THREE.VideoTexture(video);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  const resolution = new THREE.Vector2(
    window.innerWidth  * window.devicePixelRatio,
    window.innerHeight * window.devicePixelRatio,
  );

  const fluidSim = new FluidSim(renderer);
  fluidSim.reset();

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    resolution.set(
      window.innerWidth  * window.devicePixelRatio,
      window.innerHeight * window.devicePixelRatio,
    );
  });

  const startTime = performance.now();

  function animate() {
    requestAnimationFrame(animate);
    texture.needsUpdate = true;
    const t = (performance.now() - startTime) / 1000;
    fluidSim.update(texture);
    fluidSim.display(texture, t, resolution);
  }

  animate();
}

main();
