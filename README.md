# Camera Shader

Fullscreen camera feed processed through a GLSL shader. Runs in Chromium on
Raspberry Pi (kiosk / file://) and in any modern browser on mobile or desktop.

## Project layout

```
index.html          — page shell, Three.js import map
main.js             — camera setup, Three.js scene, render loop
shaders/
  vertex.glsl       — passthrough vertex stage
  fragment.glsl     — effect shader (swap this to change the look)
```

## Running locally (desktop / mobile)

Serve the folder over HTTP so the browser can fetch the `.glsl` files:

```bash
# Python 3 (built-in)
python3 -m http.server 8080

# Node (npx, no install)
npx serve .
```

Then open `http://localhost:8080` in your browser.
Grant camera permission when prompted.

---

## Raspberry Pi kiosk (file://)

### One-time setup

```bash
# Install Chromium if not already present
sudo apt install -y chromium-browser

# Clone / copy the project
git clone <repo> /home/pi/camera-shader
# or: scp -r . pi@raspberrypi:/home/pi/camera-shader
```

### Launch command

```bash
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --autoplay-policy=no-user-gesture-required \
  --allow-file-access-from-files \
  file:///home/pi/camera-shader/index.html
```

| Flag | Why it's needed |
|------|----------------|
| `--kiosk` | Fullscreen, no browser chrome |
| `--autoplay-policy=no-user-gesture-required` | Lets the `<video>` element autoplay without a user tap |
| `--allow-file-access-from-files` | Allows `fetch()` of the `.glsl` files when opened via `file://` |

### Auto-start on boot (systemd)

Create `/etc/systemd/system/kiosk.service`:

```ini
[Unit]
Description=Camera Shader Kiosk
After=graphical.target

[Service]
User=pi
Environment=DISPLAY=:0
ExecStart=/usr/bin/chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --autoplay-policy=no-user-gesture-required \
  --allow-file-access-from-files \
  file:///home/pi/camera-shader/index.html
Restart=on-failure

[Install]
WantedBy=graphical.target
```

```bash
sudo systemctl enable kiosk
sudo systemctl start kiosk
```

---

## Writing a new effect

Only `shaders/fragment.glsl` needs to change.  The uniforms are:

| Uniform | Type | Description |
|---------|------|-------------|
| `uTexture` | `sampler2D` | Live camera frame |
| `uTime` | `float` | Seconds since page load |
| `uResolution` | `vec2` | Canvas size in physical pixels |

The interpolated varying `vUv` gives texture coordinates `(0,0)`→`(1,1)`.

`gl_FragCoord.xy / uResolution` gives the same range from pixel coordinates
(useful when you want pixel-exact measurements).

Several commented-out examples are in `fragment.glsl`:
- Greyscale
- Inverted colours
- Chromatic aberration
- Pixelate
- Scanlines

---

## Offline Three.js (fully air-gapped RPi)

The import map in `index.html` points to jsDelivr CDN.  For a fully offline
deployment, download the module build once and update the map:

```bash
curl -Lo vendor/three.module.js \
  https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js
```

Then in `index.html` change:

```json
"three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"
```

to:

```json
"three": "./vendor/three.module.js"
```
