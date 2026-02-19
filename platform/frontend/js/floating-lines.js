/**
 * FloatingLines — Vanilla JS port of the React/Three.js component.
 * Depends on Three.js loaded globally (via CDN).
 *
 * Usage:
 *   new FloatingLines(document.getElementById('myContainer'), { ...options });
 */

class FloatingLines {
  constructor(container, options = {}) {
    if (!container) throw new Error('FloatingLines: container element is required');
    this._container = container;
    this._opts = Object.assign({
      linesGradient: [],
      enabledWaves: ['top', 'middle', 'bottom'],
      lineCount: 7,
      lineDistance: 11,
      topWavePosition: { x: 10.0, y: 0.5, rotate: -0.4 },
      middleWavePosition: { x: 5.0, y: 0.0, rotate: 0.2 },
      bottomWavePosition: { x: 2.0, y: -0.7, rotate: 0.4 },
      animationSpeed: 1,
      interactive: true,
      bendRadius: 30,
      bendStrength: -0.5,
      mouseDamping: 0.05,
      parallax: true,
      parallaxStrength: 0.2,
      mixBlendMode: 'screen',
    }, options);

    this._raf = null;
    this._ro = null;

    this._targetMouse = new THREE.Vector2(-1000, -1000);
    this._currentMouse = new THREE.Vector2(-1000, -1000);
    this._targetInfluence = 0;
    this._currentInfluence = 0;
    this._targetParallax = new THREE.Vector2(0, 0);
    this._currentParallax = new THREE.Vector2(0, 0);

    this._init();
  }

  // ── helpers ──
  _getLineCount(wave) {
    const { lineCount, enabledWaves } = this._opts;
    if (typeof lineCount === 'number') return lineCount;
    const idx = enabledWaves.indexOf(wave);
    return (idx >= 0 && lineCount[idx] != null) ? lineCount[idx] : 6;
  }

  _getLineDistance(wave) {
    const { lineDistance, enabledWaves } = this._opts;
    if (typeof lineDistance === 'number') return lineDistance;
    const idx = enabledWaves.indexOf(wave);
    return (idx >= 0 && lineDistance[idx] != null) ? lineDistance[idx] : 5;
  }

  _hexToVec3(hex) {
    let v = hex.trim().replace(/^#/, '');
    if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    const r = parseInt(v.slice(0, 2), 16) / 255;
    const g = parseInt(v.slice(2, 4), 16) / 255;
    const b = parseInt(v.slice(4, 6), 16) / 255;
    return new THREE.Vector3(r, g, b);
  }

  _init() {
    const o = this._opts;
    const enabled = o.enabledWaves;

    const topCount = enabled.includes('top') ? this._getLineCount('top') : 0;
    const midCount = enabled.includes('middle') ? this._getLineCount('middle') : 0;
    const botCount = enabled.includes('bottom') ? this._getLineCount('bottom') : 0;
    const topDist = (enabled.includes('top') ? this._getLineDistance('top') : 5) * 0.01;
    const midDist = (enabled.includes('middle') ? this._getLineDistance('middle') : 5) * 0.01;
    const botDist = (enabled.includes('bottom') ? this._getLineDistance('bottom') : 5) * 0.01;

    // Scene
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._camera.position.z = 1;

    this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this._renderer.setClearColor(0x000000, 0); // fully transparent background
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._renderer.domElement.style.width = '100%';
    this._renderer.domElement.style.height = '100%';
    this._renderer.domElement.style.display = 'block';
    this._container.appendChild(this._renderer.domElement);

    // Gradient stops
    const MAX_STOPS = 8;
    const gradientColors = Array.from({ length: MAX_STOPS }, () => new THREE.Vector3(1, 1, 1));
    const gradientStops = (o.linesGradient || []).slice(0, MAX_STOPS);
    gradientStops.forEach((hex, i) => {
      const v = this._hexToVec3(hex);
      gradientColors[i].set(v.x, v.y, v.z);
    });

    this._uniforms = {
      iTime: { value: 0 },
      iResolution: { value: new THREE.Vector3(1, 1, 1) },
      animationSpeed: { value: o.animationSpeed },

      enableTop: { value: enabled.includes('top') },
      enableMiddle: { value: enabled.includes('middle') },
      enableBottom: { value: enabled.includes('bottom') },

      topLineCount: { value: topCount },
      middleLineCount: { value: midCount },
      bottomLineCount: { value: botCount },

      topLineDistance: { value: topDist },
      middleLineDistance: { value: midDist },
      bottomLineDistance: { value: botDist },

      topWavePosition: { value: new THREE.Vector3(o.topWavePosition.x, o.topWavePosition.y, o.topWavePosition.rotate) },
      middleWavePosition: { value: new THREE.Vector3(o.middleWavePosition.x, o.middleWavePosition.y, o.middleWavePosition.rotate) },
      bottomWavePosition: { value: new THREE.Vector3(o.bottomWavePosition.x, o.bottomWavePosition.y, o.bottomWavePosition.rotate) },

      iMouse: { value: new THREE.Vector2(-1000, -1000) },
      interactive: { value: o.interactive },
      bendRadius: { value: o.bendRadius },
      bendStrength: { value: o.bendStrength },
      bendInfluence: { value: 0 },

      parallax: { value: o.parallax },
      parallaxStrength: { value: o.parallaxStrength },
      parallaxOffset: { value: new THREE.Vector2(0, 0) },

      lineGradient: { value: gradientColors },
      lineGradientCount: { value: gradientStops.length },
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this._uniforms,
      vertexShader: `
        precision highp float;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;

        uniform float iTime;
        uniform vec3  iResolution;
        uniform float animationSpeed;

        uniform bool enableTop;
        uniform bool enableMiddle;
        uniform bool enableBottom;

        uniform int topLineCount;
        uniform int middleLineCount;
        uniform int bottomLineCount;

        uniform float topLineDistance;
        uniform float middleLineDistance;
        uniform float bottomLineDistance;

        uniform vec3 topWavePosition;
        uniform vec3 middleWavePosition;
        uniform vec3 bottomWavePosition;

        uniform vec2 iMouse;
        uniform bool interactive;
        uniform float bendRadius;
        uniform float bendStrength;
        uniform float bendInfluence;

        uniform bool parallax;
        uniform float parallaxStrength;
        uniform vec2 parallaxOffset;

        uniform vec3 lineGradient[8];
        uniform int lineGradientCount;

        const vec3 BLACK = vec3(0.0);
        const vec3 PINK  = vec3(233.0, 71.0, 245.0) / 255.0;
        const vec3 BLUE  = vec3(47.0,  75.0, 162.0) / 255.0;

        mat2 rotate(float r) {
          return mat2(cos(r), sin(r), -sin(r), cos(r));
        }

        vec3 background_color(vec2 uv) {
          vec3 col = vec3(0.0);
          float y = sin(uv.x - 0.2) * 0.3 - 0.1;
          float m = uv.y - y;
          col += mix(BLUE, BLACK, smoothstep(0.0, 1.0, abs(m)));
          col += mix(PINK, BLACK, smoothstep(0.0, 1.0, abs(m - 0.8)));
          return col * 0.5;
        }

        vec3 getLineColor(float t, vec3 baseColor) {
          if (lineGradientCount <= 0) return baseColor;
          if (lineGradientCount == 1) return lineGradient[0]; // no dimming
          float clampedT = clamp(t, 0.0, 0.9999);
          float scaled = clampedT * float(lineGradientCount - 1);
          int idx = int(floor(scaled));
          float f = fract(scaled);
          int idx2 = min(idx + 1, lineGradientCount - 1);
          return mix(lineGradient[idx], lineGradient[idx2], f); // full brightness
        }

        float wave(vec2 uv, float offset, vec2 screenUv, vec2 mouseUv, bool shouldBend) {
          float time = iTime * animationSpeed;
          float x_offset   = offset;
          float x_movement = time * 0.1;
          float amp        = sin(offset + time * 0.2) * 0.3;
          float y          = sin(uv.x + x_offset + x_movement) * amp;
          if (shouldBend) {
            vec2 d = screenUv - mouseUv;
            float influence = exp(-dot(d, d) * bendRadius);
            float bendOffset = (mouseUv.y - screenUv.y) * influence * bendStrength * bendInfluence;
            y += bendOffset;
          }
          float m = uv.y - y;
          return 0.0175 / max(abs(m) + 0.01, 1e-3) + 0.01;
        }

        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
          vec2 baseUv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
          baseUv.y *= -1.0;
          if (parallax) baseUv += parallaxOffset;

          vec3 col = vec3(0.0);
          vec3 b = lineGradientCount > 0 ? vec3(0.0) : background_color(baseUv);

          vec2 mouseUv = vec2(0.0);
          if (interactive) {
            mouseUv = (2.0 * iMouse - iResolution.xy) / iResolution.y;
            mouseUv.y *= -1.0;
          }

          if (enableBottom) {
            for (int i = 0; i < 64; ++i) {
              if (i >= bottomLineCount) break;
              float fi = float(i);
              float t = fi / max(float(bottomLineCount - 1), 1.0);
              vec3 lineCol = getLineColor(t, b);
              float angle = bottomWavePosition.z * log(length(baseUv) + 1.0);
              vec2 ruv = baseUv * rotate(angle);
              col += lineCol * wave(
                ruv + vec2(bottomLineDistance * fi + bottomWavePosition.x, bottomWavePosition.y),
                1.5 + 0.2 * fi, baseUv, mouseUv, interactive) * 0.2;
            }
          }

          if (enableMiddle) {
            for (int i = 0; i < 64; ++i) {
              if (i >= middleLineCount) break;
              float fi = float(i);
              float t = fi / max(float(middleLineCount - 1), 1.0);
              vec3 lineCol = getLineColor(t, b);
              float angle = middleWavePosition.z * log(length(baseUv) + 1.0);
              vec2 ruv = baseUv * rotate(angle);
              col += lineCol * wave(
                ruv + vec2(middleLineDistance * fi + middleWavePosition.x, middleWavePosition.y),
                2.0 + 0.15 * fi, baseUv, mouseUv, interactive);
            }
          }

          if (enableTop) {
            for (int i = 0; i < 64; ++i) {
              if (i >= topLineCount) break;
              float fi = float(i);
              float t = fi / max(float(topLineCount - 1), 1.0);
              vec3 lineCol = getLineColor(t, b);
              float angle = topWavePosition.z * log(length(baseUv) + 1.0);
              vec2 ruv = baseUv * rotate(angle);
              ruv.x *= -1.0;
              col += lineCol * wave(
                ruv + vec2(topLineDistance * fi + topWavePosition.x, topWavePosition.y),
                1.0 + 0.2 * fi, baseUv, mouseUv, interactive) * 0.1;
            }
          }

          // Output: transparent background, lines on top
          // col is additive brightness — where col > 0 there's a line
          float brightness = dot(col, vec3(0.333));
          float a = clamp(brightness * 8.0, 0.0, 1.0); // alpha = 1 where lines are
          fragColor = vec4(col, a);
        }

        void main() {
          vec4 color = vec4(0.0);
          mainImage(color, gl_FragCoord.xy);
          gl_FragColor = color;
        }
      `,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    this._mesh = new THREE.Mesh(geometry, material);
    this._scene.add(this._mesh);

    this._clock = new THREE.Clock();
    this._setSize();

    // ResizeObserver
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._setSize());
      this._ro.observe(this._container);
    }

    // Mouse interactivity
    if (o.interactive) {
      this._onPointerMove = this._handlePointerMove.bind(this);
      this._onPointerLeave = this._handlePointerLeave.bind(this);
      this._renderer.domElement.addEventListener('pointermove', this._onPointerMove);
      this._renderer.domElement.addEventListener('pointerleave', this._onPointerLeave);
    }

    this._renderLoop();
  }

  _setSize() {
    const el = this._container;
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    this._renderer.setSize(w, h, false);
    const dpr = this._renderer.getPixelRatio();
    this._uniforms.iResolution.value.set(w * dpr, h * dpr, 1);
  }

  _handlePointerMove(e) {
    const rect = this._renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dpr = this._renderer.getPixelRatio();
    this._targetMouse.set(x * dpr, (rect.height - y) * dpr);
    this._targetInfluence = 1.0;

    if (this._opts.parallax) {
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      this._targetParallax.set(
        ((x - cx) / rect.width) * this._opts.parallaxStrength,
        ((cy - y) / rect.height) * this._opts.parallaxStrength,
      );
    }
  }

  _handlePointerLeave() {
    this._targetInfluence = 0.0;
  }

  _lerp(a, b, t) { return a + (b - a) * t; }

  _renderLoop() {
    const u = this._uniforms;
    const o = this._opts;
    const md = o.mouseDamping;

    u.iTime.value = this._clock.getElapsedTime();

    if (o.interactive) {
      this._currentMouse.lerp(this._targetMouse, md);
      u.iMouse.value.copy(this._currentMouse);
      this._currentInfluence += (this._targetInfluence - this._currentInfluence) * md;
      u.bendInfluence.value = this._currentInfluence;
    }

    if (o.parallax) {
      this._currentParallax.lerp(this._targetParallax, md);
      u.parallaxOffset.value.copy(this._currentParallax);
    }

    this._renderer.render(this._scene, this._camera);
    this._raf = requestAnimationFrame(() => this._renderLoop());
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();

    const o = this._opts;
    if (o.interactive && this._onPointerMove) {
      this._renderer.domElement.removeEventListener('pointermove', this._onPointerMove);
      this._renderer.domElement.removeEventListener('pointerleave', this._onPointerLeave);
    }

    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
    this._renderer.dispose();
    if (this._renderer.domElement.parentElement) {
      this._renderer.domElement.parentElement.removeChild(this._renderer.domElement);
    }
  }
}
