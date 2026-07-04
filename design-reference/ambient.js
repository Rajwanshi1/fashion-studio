/* TANVI AGNIHOTRY — interactive ambient layer v2 (shared)
   1) Silk-thread cursor trail (three.js) — a tapering gold thread
      that follows the pointer and collapses when idle.
   2) Magnetic CTAs — buttons lean subtly toward the cursor.
   3) Hero parallax — slow depth shift on scroll.
   Skips: same-origin capture frames, reduced motion, touch (trail/magnet). */
(function () {
  try { if (window.frameElement && window.frameElement.closest('.frame')) return; } catch (e) {}
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const FINE = matchMedia('(pointer: fine)').matches;
  const THREE_SRC = 'https://unpkg.com/three@0.158.0/build/three.min.js';

  /* ---------- 1. Silk-thread cursor trail ---------- */
  function threadTrail() {
    if (!window.THREE || !FINE) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch (e) { return; }

    const canvas = renderer.domElement;
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:120;pointer-events:none;';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);

    const scene = new THREE.Scene();
    let W = innerWidth, H = innerHeight;
    const camera = new THREE.OrthographicCamera(0, W, 0, H, -10, 10);

    const N = 32;                       // trail points
    const pts = [];
    for (let i = 0; i < N; i++) pts.push({ x: -100, y: -100 });

    // triangle-strip ribbon: 2 verts per point
    const positions = new Float32Array(N * 2 * 3);
    const alphas = new Float32Array(N * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    const idx = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(0xB0894A) }, uOpacity: { value: 0.0 } },
      vertexShader: 'attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor, vA * uOpacity); }',
    });
    scene.add(new THREE.Mesh(geo, mat));

    let mx = -100, my = -100, lastMove = 0, visible = false;
    window.addEventListener('pointermove', (e) => {
      mx = e.clientX; my = e.clientY; lastMove = performance.now();
      if (!visible) { pts.forEach(p => { p.x = mx; p.y = my; }); visible = true; }
    }, { passive: true });
    document.addEventListener('pointerleave', () => { lastMove = 0; });

    function resize() {
      W = innerWidth; H = innerHeight;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(W, H, false);
      camera.right = W; camera.bottom = H;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    let running = true;
    document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) tick(); });

    const MAXW = 3.2;                   // thread half-width at head (px)
    function tick() {
      if (!running) return;
      const idle = performance.now() - lastMove > 900;

      // head chases pointer; tail cascades for a silk feel
      pts[0].x += (mx - pts[0].x) * 0.42;
      pts[0].y += (my - pts[0].y) * 0.42;
      for (let i = 1; i < N; i++) {
        const k = idle ? 0.55 : 0.34;   // collapse faster when idle
        pts[i].x += (pts[i - 1].x - pts[i].x) * k;
        pts[i].y += (pts[i - 1].y - pts[i].y) * k;
      }

      // fade in/out
      const target = idle ? 0 : 0.5;
      mat.uniforms.uOpacity.value += (target - mat.uniforms.uOpacity.value) * 0.06;

      // rebuild ribbon
      for (let i = 0; i < N; i++) {
        const p = pts[i];
        const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(N - 1, i + 1)];
        let dx = next.x - prev.x, dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const t = 1 - i / (N - 1);      // 1 at head → 0 at tail
        const w = MAXW * Math.pow(t, 0.6) + 0.2;
        const nx = -dy * w, ny = dx * w;
        positions[i * 6] = p.x + nx; positions[i * 6 + 1] = p.y + ny; positions[i * 6 + 2] = 0;
        positions[i * 6 + 3] = p.x - nx; positions[i * 6 + 4] = p.y - ny; positions[i * 6 + 5] = 0;
        const a = Math.pow(t, 1.6);
        alphas[i * 2] = a; alphas[i * 2 + 1] = a;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;

      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    }
    tick();

    window.addEventListener('beforeprint', () => { canvas.style.display = 'none'; });
    window.addEventListener('afterprint', () => { canvas.style.display = ''; });
  }

  /* ---------- 2. Magnetic CTAs ---------- */
  function magneticButtons() {
    if (!FINE) return;
    const els = document.querySelectorAll('.btn-buy, .btn-outline, .btn-solid, .btn-ghost');
    els.forEach(el => {
      el.style.transition = 'transform 320ms cubic-bezier(0.22,1,0.36,1), background 520ms, color 520ms, border-color 520ms';
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = 'translate(' + dx * 0.14 + 'px,' + dy * 0.22 + 'px)';
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* ---------- 3. Hero parallax ---------- */
  function parallax() {
    const layers = document.querySelectorAll('header.hero > image-slot, .look > image-slot, .lb-cover > image-slot, .house-hero > image-slot');
    if (!layers.length) return;
    layers.forEach(el => { el.style.willChange = 'transform'; el.style.transform = 'scale(1.12)'; });
    let ticking = false;
    function update() {
      ticking = false;
      layers.forEach(el => {
        const r = el.parentElement.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;
        const progress = (r.top + r.height / 2 - innerHeight / 2) / innerHeight; // -~1..1
        el.style.transform = 'scale(1.12) translateY(' + (progress * r.height * 0.06).toFixed(1) + 'px)';
      });
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
  }

  function load() {
    magneticButtons();
    parallax();
    if (!FINE) return;                  // trail is pointer-only
    if (window.THREE) return threadTrail();
    const s = document.createElement('script');
    s.src = THREE_SRC;
    s.onload = threadTrail;
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
