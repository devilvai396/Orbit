export function mountOrbit(root, env) {
  const RINGS = 4;
  const MAX_PLANETS = 10;

  const palette = ["#22c55e","#60a5fa","#a78bfa","#f472b6","#fbbf24","#34d399","#fb7185","#c084fc"];

  const state = {
    env,
    seed: "",
    rings: Array.from({length: RINGS}, () => []), // arrays of planet ids
    planets: {}, // id -> {id, name, color, ring, angle, speed}
    drag: { active:false, id:null, offsetX:0, offsetY:0 },
  };

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }

  function rngFromSeed(seed) {
    // xorshift32
    let x = 0;
    for (let i=0;i<seed.length;i++) x = (x*31 + seed.charCodeAt(i)) >>> 0;
    return function() {
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17; x >>>= 0;
      x ^= x << 5;  x >>>= 0;
      return (x >>> 0) / 4294967296;
    };
  }

  function loadOrInit() {
    const key = "orbit:v1:" + todayKey();
    state.seed = key;
    const saved = safeJsonParse(localStorage.getItem(key));
    if (saved && saved.planets && saved.rings) {
      state.planets = saved.planets;
      state.rings = saved.rings;
      // ensure derived fields
      Object.values(state.planets).forEach(p => {
        if (typeof p.angle !== "number") p.angle = Math.random()*Math.PI*2;
        if (typeof p.speed !== "number") p.speed = 0.003 + Math.random()*0.01;
      });
    } else {
      // new daily seed: start with 3 planets
      const rnd = rngFromSeed(key);
      state.planets = {};
      state.rings = Array.from({length: RINGS}, () => []);
      for (let i=0;i<3;i++) addPlanet(true, rnd);
      persist();
    }
  }

  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function persist() {
    const key = state.seed;
    try {
      localStorage.setItem(key, JSON.stringify({ planets: state.planets, rings: state.rings }));
    } catch {}
  }

  function uid() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function addPlanet(initial=false, rndFn=null) {
    const total = Object.keys(state.planets).length;
    if (total >= MAX_PLANETS) return;
    const id = uid();
    const rnd = rndFn || Math.random;
    const color = palette[Math.floor((rnd()*palette.length))];
    const ring = Math.floor(rnd()*RINGS);
    const name = initial ? ["Friend","Work","Home"][total] || "Planet" : "Planet";
    const p = {
      id, name,
      color,
      ring,
      angle: rnd()*Math.PI*2,
      speed: 0.003 + rnd()*0.01
    };
    state.planets[id] = p;
    state.rings[ring].push(id);
    persist();
    render();
  }

  function clearToday() {
    // wipe today's key only
    try { localStorage.removeItem(state.seed); } catch {}
    loadOrInit();
    render();
  }

  function ringHit(x, y, cx, cy) {
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    // ring thresholds: 0..RINGS-1
    // returns ring index nearest to dist band
    const maxR = Math.min(cx, cy) * 0.78;
    const step = maxR / RINGS;
    let idx = Math.floor(dist / step);
    if (idx < 0) idx = 0;
    if (idx >= RINGS) idx = RINGS-1;
    return idx;
  }

  function moveToRing(id, newRing) {
    const p = state.planets[id];
    if (!p) return;
    if (p.ring === newRing) return;
    // remove from old ring
    const arr = state.rings[p.ring];
    state.rings[p.ring] = arr.filter(x => x !== id);
    // add to new ring
    state.rings[newRing].push(id);
    p.ring = newRing;
    persist();
    render();
  }

  function renamePlanet(id) {
    const p = state.planets[id];
    if (!p) return;
    const next = prompt("Name this planet:", p.name || "Planet");
    if (next === null) return;
    p.name = (next || "Planet").slice(0,16);
    persist();
    render();
  }

  function removePlanet(id) {
    const p = state.planets[id];
    if (!p) return;
    delete state.planets[id];
    state.rings[p.ring] = state.rings[p.ring].filter(x => x !== id);
    persist();
    render();
  }

  function haptic() {
    if (navigator.vibrate) navigator.vibrate(10);
  }

  function render() {
    root.innerHTML = `
      <div class="wrap">
        <header class="top">
          <div class="brand">
            <div class="logo">ORBIT</div>
            <div class="sub">${env.isMini ? "Mini App" : "Web"} • ${todayKey()}</div>
          </div>
          <button class="btn ghost" id="reset" title="Reset today">Reset</button>
        </header>

        <main class="card">
          <div class="hint">
            Add up to ${MAX_PLANETS} planets. Drag them between rings. Tap a planet to rename. Long-press to remove.
          </div>

          <div class="arena">
            <canvas id="cv" width="360" height="360" aria-label="Orbit canvas"></canvas>
            <div class="legend" id="legend"></div>
          </div>

          <div class="actions">
            <button class="btn" id="add">Add</button>
            <button class="btn ghost" id="shuffle">Shuffle</button>
          </div>
        </main>

        <footer class="foot">
          <div class="envpill">${env.isMini ? "Farcaster/Base" : "Web preview"}</div>
          <div class="tiny">Daily seed resets automatically.</div>
        </footer>
      </div>
    `;

    root.querySelector("#add").addEventListener("click", () => { addPlanet(false); haptic(); });
    root.querySelector("#shuffle").addEventListener("click", () => { randomizeSpeeds(); haptic(); });
    root.querySelector("#reset").addEventListener("click", () => {
      if (confirm("Reset today's orbit?")) clearToday();
    });

    const cv = root.querySelector("#cv");
    const ctx = cv.getContext("2d");
    const legend = root.querySelector("#legend");

    // fit to container
    requestAnimationFrame(() => {
      const box = cv.getBoundingClientRect();
      const size = Math.floor(Math.min(box.width, 360));
      cv.width = size * devicePixelRatio;
      cv.height = size * devicePixelRatio;
      cv.style.width = size + "px";
      cv.style.height = size + "px";
      ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
    });

    buildLegend(legend);

    // pointer events for drag
    let pressTimer = null;
    cv.addEventListener("pointerdown", (e) => {
      const hit = planetAtEvent(e, cv);
      if (hit) {
        state.drag.active = true;
        state.drag.id = hit.id;
        const pxy = toCanvasXY(e, cv);
        state.drag.offsetX = pxy.x - hit.x;
        state.drag.offsetY = pxy.y - hit.y;

        pressTimer = setTimeout(() => {
          // long press => remove
          if (state.drag.active && state.drag.id === hit.id) {
            removePlanet(hit.id);
            state.drag.active = false;
            state.drag.id = null;
            haptic();
          }
        }, 520);
      }
    });

    cv.addEventListener("pointermove", (e) => {
      if (!state.drag.active) return;
      const p = state.planets[state.drag.id];
      if (!p) return;
      const {x,y} = toCanvasXY(e, cv);
      // update angle based on pointer location
      const cx = cv.clientWidth/2;
      const cy = cv.clientHeight/2;
      const dx = x - cx, dy = y - cy;
      p.angle = Math.atan2(dy, dx);
      // move ring based on distance
      const newRing = ringHit(x, y, cx, cy);
      if (newRing !== p.ring) { moveToRing(p.id, newRing); haptic(); }
      persist();
    });

    function endPointer(e) {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      if (!state.drag.active) return;
      const hit = planetAtEvent(e, cv);
      // tap (no drag): rename
      if (hit && hit.id === state.drag.id) {
        // only rename if pointer didn't move much; we don't track delta, so rename on quick up
        setTimeout(() => renamePlanet(hit.id), 0);
      }
      state.drag.active = false;
      state.drag.id = null;
      persist();
    }

    cv.addEventListener("pointerup", endPointer);
    cv.addEventListener("pointercancel", endPointer);

    // animation
    let raf = 0;
    function tick() {
      draw(ctx, cv);
      raf = requestAnimationFrame(tick);
    }
    tick();

    // cleanup if remount
    return () => cancelAnimationFrame(raf);
  }

  function randomizeSpeeds() {
    Object.values(state.planets).forEach(p => {
      p.speed = 0.003 + Math.random()*0.012;
    });
    persist();
    render();
  }

  function buildLegend(el) {
    const ids = Object.keys(state.planets);
    el.innerHTML = ids.length ? ids.map(id => {
      const p = state.planets[id];
      return `
        <div class="leg">
          <span class="dot" style="background:${p.color}"></span>
          <span class="name">${escapeHtml(p.name || "Planet")}</span>
          <span class="ring">R${p.ring+1}</span>
        </div>
      `;
    }).join("") : `<div class="empty">Add a planet to start.</div>`;
  }

  function toCanvasXY(e, cv) {
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * (cv.clientWidth / r.width);
    const y = (e.clientY - r.top) * (cv.clientHeight / r.height);
    return {x,y};
  }

  function planetAtEvent(e, cv) {
    const {x,y} = toCanvasXY(e, cv);
    const cx = cv.clientWidth/2, cy = cv.clientHeight/2;
    const maxR = Math.min(cx, cy) * 0.78;
    const step = maxR / RINGS;

    for (const p of Object.values(state.planets)) {
      const r = step*(p.ring+0.5);
      const px = cx + r*Math.cos(p.angle);
      const py = cy + r*Math.sin(p.angle);
      const rr = 10;
      const dx = x - px, dy = y - py;
      if (dx*dx + dy*dy <= rr*rr) return { id: p.id, x: px, y: py };
    }
    return null;
  }

  function draw(ctx, cv) {
    const w = cv.clientWidth, h = cv.clientHeight;
    ctx.clearRect(0,0,w,h);

    // bg glow
    const g = ctx.createRadialGradient(w*0.35,h*0.25,10,w*0.5,h*0.6,w*0.8);
    g.addColorStop(0,"rgba(99,102,241,.18)");
    g.addColorStop(1,"rgba(2,6,23,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,w,h);

    const cx = w/2, cy = h/2;
    const maxR = Math.min(cx, cy) * 0.78;
    const step = maxR / RINGS;

    // rings
    for (let i=1;i<=RINGS;i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, step*i, 0, Math.PI*2);
      ctx.strokeStyle = "rgba(148,163,184,.22)";
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }

    // center
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI*2);
    ctx.fillStyle = "rgba(226,232,240,.9)";
    ctx.fill();

    // planets
    const now = performance.now();
    for (const p of Object.values(state.planets)) {
      if (!state.drag.active || state.drag.id !== p.id) {
        p.angle += p.speed;
      }
      const r = step*(p.ring+0.5);
      const x = cx + r*Math.cos(p.angle);
      const y = cy + r*Math.sin(p.angle);

      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI*2);
      ctx.fillStyle = p.color;
      ctx.fill();

      // subtle halo
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI*2);
      ctx.strokeStyle = "rgba(226,232,240,.10)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // title stamp
    ctx.fillStyle = "rgba(148,163,184,.7)";
    ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText("Drag planets between rings", 12, h-14);

    persist();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // init
  loadOrInit();
  render();
}
