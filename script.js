(() => {
  "use strict";

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const fmt = (n) => "$" + Math.max(0, Math.round(n)).toLocaleString();
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };

  function lerpAngle(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  // ---------- DOM ----------
  const canvas = $("simCanvas");
  const miniMap = $("miniMap");
  const toast = $("toast");
  const simStatus = $("simStatus");

  const elBuyers = $("buyers");
  const elVolume = $("volume");
  const elMcap = $("mcap");
  const elColonies = $("colonies");
  const elWorms = $("worms");

  const eventListEl = $("eventList");
  const chipBtns = Array.from(document.querySelectorAll(".chip[data-filter]"));

  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return;

  const mctx = miniMap ? miniMap.getContext("2d", { alpha: true }) : null;

  // ---------- iOS-safe canvas sizing ----------
  let W = 1, H = 1, DPR = 1;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);

    const pw = Math.floor(W * DPR);
    const ph = Math.floor(H * DPR);
    if (!Number.isFinite(pw) || !Number.isFinite(ph) || pw <= 0 || ph <= 0) return;

    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
  }

  const ro = new ResizeObserver(() => resizeCanvas());
  ro.observe(canvas);
  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 140), { passive: true });

  // ---------- Audio (unlocks on first gesture on iOS) ----------
  let audioOn = true;
  let audioReady = false;
  let audioCtx = null;

  function ensureAudio() {
    if (!audioOn) return;
    if (audioReady) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioReady = true;
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    } catch {
      audioReady = false;
    }
  }

  function blip(freq = 440, dur = 0.08, type = "sine", gain = 0.06) {
    if (!audioOn) return;
    ensureAudio();
    if (!audioReady || !audioCtx) return;

    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();

    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.65), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    o.connect(g);
    g.connect(audioCtx.destination);

    o.start(t0);
    o.stop(t0 + dur);
  }

  function chord(base = 220) {
    blip(base, 0.10, "triangle", 0.05);
    setTimeout(() => blip(base * 1.26, 0.11, "triangle", 0.045), 18);
    setTimeout(() => blip(base * 1.50, 0.12, "triangle", 0.040), 32);
  }

  function whoosh() {
    if (!audioOn) return;
    ensureAudio();
    if (!audioReady || !audioCtx) return;

    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(160, t0);
    o.frequency.exponentialRampToValueAtTime(45, t0 + 0.22);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.075, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);

    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t0);
    o.stop(t0 + 0.24);
  }

  window.addEventListener("pointerdown", () => ensureAudio(), { once: true, passive: true });

  // ---------- Toast ----------
  let toastTO = null;
  function setToast(msg, ms = 1200) {
    if (!toast) return;
    toast.textContent = msg;
    toast.style.opacity = "0.95";
    clearTimeout(toastTO);
    toastTO = setTimeout(() => {
      toast.style.opacity = "0.88";
    }, ms);
  }

  // ---------- Events (capped + scroll; sim-only) ----------
  const LOG_CAP = 80;
  let filterMode = "ALL";
  const events = []; // {kind,msg,t,count}

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderEvents() {
    if (!eventListEl) return;
    const rows = [];
    for (const e of events) {
      if (filterMode !== "ALL" && e.kind !== filterMode) continue;
      const count = e.count > 1 ? ` <span class="dim">(x${e.count})</span>` : "";
      rows.push(
        `<div class="eventRow"><span class="tag ${e.kind}">${e.kind}:</span> ${escapeHtml(e.msg)}${count}</div>`
      );
    }
    eventListEl.innerHTML = rows.join("") || `<div class="eventRow"><span class="dim">No events yet…</span></div>`;
  }

  function addEvent(kind, msg) {
    const t = Date.now();
    const last = events[0];

    if (last && last.kind === kind && last.msg === msg && (t - last.t) < 1400) {
      last.count = (last.count || 1) + 1;
      last.t = t;
    } else {
      events.unshift({ kind, msg, t, count: 1 });
      if (events.length > LOG_CAP) events.length = LOG_CAP;
    }

    // sound + toast
    if (kind === "BOSS") { chord(140); setToast("⚠ Boss worm emerged", 1500); }
    if (kind === "DASH") { whoosh(); chord(180); setToast("⚡ Boss dash", 1200); }
    if (kind === "EVENT" && msg.includes("New colony")) { chord(220); setToast("✨ New colony spawned", 1400); }
    if (kind === "MUTATION") { blip(520, 0.07, "sine", 0.045); }
    if (kind === "HATCH") { blip(360, 0.06, "triangle", 0.040); }

    renderEvents();
  }

  chipBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      chipBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filterMode = btn.dataset.filter || "ALL";
      renderEvents();
      blip(260, 0.05, "sine", 0.03);
    });
  });

  // ---------- Economy / progression ----------
  let buyers = 0;
  let volume = 0;
  let mcap = 0;

  const MAX_COLONIES = 16;
  const MC_STEP = 25000;
  let nextSplitAt = MC_STEP;
  let bossSpawned = false;

  function growthScore() {
    return (mcap / 20000) + (volume / 6000) + (buyers / 10);
  }

  // ---------- Camera / interaction ----------
  let camX = 0, camY = 0, zoom = 0.85;
  let dragging = false, lastX = 0, lastY = 0;
  let selected = 0;
  let focusOn = false;

  let isInteracting = false;
  let labelsOn = true;
  let miniMapOn = false;

  function toWorld(px, py) {
    return {
      x: (px - W / 2) / zoom - camX,
      y: (py - H / 2) / zoom - camY
    };
  }

  function pickColony(wx, wy) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];
      const d = dist2(wx, wy, c.x, c.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return (best !== -1 && bestD < 280 * 280) ? best : -1;
  }

  function centerOnSelected(smooth = true) {
    const c = colonies[selected];
    if (!c) return;
    if (!smooth) {
      camX = -c.x;
      camY = -c.y;
      return;
    }
    camX = lerp(camX, -c.x, 0.18);
    camY = lerp(camY, -c.y, 0.18);
  }

  // tap feedback rings
  const tapRings = [];
  function ring(x, y) {
    tapRings.push({ x, y, r: 10, a: 0.9 });
    blip(240, 0.05, "sine", 0.02);
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    dragging = true;
    isInteracting = true;
    lastX = e.clientX; lastY = e.clientY;
  }, { passive: true });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    camX += dx / zoom;
    camY += dy / zoom;
  }, { passive: true });

  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    isInteracting = false;

    const w = toWorld(e.clientX, e.clientY);
    ring(w.x, w.y);

    const idx = pickColony(w.x, w.y);
    if (idx !== -1) {
      selected = idx;
      const c = colonies[idx];
      addEvent("EVENT", `Selected Colony #${idx + 1} • ${c.dna.temperament} • ${c.dna.biome}`);
      setToast(`Colony #${idx + 1} • ${c.dna.temperament} • ${c.dna.style}`, 1100);
      if (focusOn) centerOnSelected(true);
    }
  }, { passive: true });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
    isInteracting = false;
  }, { passive: true });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    isInteracting = true;
    const k = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = clamp(zoom * k, 0.55, 2.6);
    clearTimeout(canvas.__wheelTO);
    canvas.__wheelTO = setTimeout(() => (isInteracting = false), 140);
  }, { passive: false });

  let lastTap = 0;
  canvas.addEventListener("touchend", () => {
    const t = Date.now();
    if (t - lastTap < 280) centerOnSelected(false);
    lastTap = t;
  }, { passive: true });

  // ---------- Background: stars + galaxies + nebulas (no DOM grid) ----------
  const bg = {
    stars: [],
    nebulas: [],
    layers: [
      { par: 0.10, count: 190, size: [0.6, 1.6], a: [0.12, 0.35] },
      { par: 0.22, count: 140, size: [0.8, 2.2], a: [0.14, 0.45] },
      { par: 0.40, count: 95,  size: [1.2, 2.8], a: [0.16, 0.55] },
    ],
    worldSize: 5200,
    phase: 0,
  };

  function initBackground() {
    bg.stars.length = 0;
    bg.nebulas.length = 0;

    // nebulas
    const nebCount = 12;
    for (let i = 0; i < nebCount; i++) {
      bg.nebulas.push({
        x: rand(-bg.worldSize, bg.worldSize),
        y: rand(-bg.worldSize, bg.worldSize),
        r: rand(260, 720),
        hue: rand(170, 320),
        a: rand(0.08, 0.22),
        wob: rand(0.6, 1.6),
      });
    }

    // stars
    for (let li = 0; li < bg.layers.length; li++) {
      const L = bg.layers[li];
      for (let i = 0; i < L.count; i++) {
        bg.stars.push({
          x: rand(-bg.worldSize, bg.worldSize),
          y: rand(-bg.worldSize, bg.worldSize),
          r: rand(L.size[0], L.size[1]),
          a: rand(L.a[0], L.a[1]),
          p: L.par,
          tw: rand(0.6, 1.8),
          ph: rand(0, Math.PI * 2),
          tint: rand(0, 1),
        });
      }
    }
  }

  function drawBackground(time) {
    ctx.fillStyle = "#000";
    ctx.fillRect(-W/2 - 2, -H/2 - 2, W + 4, H + 4);

    bg.phase += 0.00025;
    const exposure = 0.92 + 0.08 * Math.sin(bg.phase);

    // nebulas
    for (const n of bg.nebulas) {
      const px = (n.x + camX) * 0.18;
      const py = (n.y + camY) * 0.18;

      const wob = Math.sin(time * 0.00025 * n.wob + n.x * 0.001) * 0.10;
      const rr = n.r * (1 + wob);

      const g = ctx.createRadialGradient(px, py, 0, px, py, rr);
      const a0 = (isInteracting ? n.a * 0.65 : n.a) * exposure;

      g.addColorStop(0, `hsla(${n.hue}, 85%, 58%, ${a0})`);
      g.addColorStop(0.45, `hsla(${(n.hue+30)%360}, 85%, 55%, ${a0 * 0.65})`);
      g.addColorStop(1, `hsla(${n.hue}, 85%, 55%, 0)`);

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, rr, 0, Math.PI * 2);
      ctx.fill();
    }

    // stars
    ctx.globalCompositeOperation = "screen";
    for (const s of bg.stars) {
      const tw = 0.65 + 0.35 * Math.sin(time * 0.0012 * s.tw + s.ph);
      const a = s.a * tw * (isInteracting ? 0.85 : 1.0) * exposure;

      const sx = (s.x + camX) * s.p;
      const sy = (s.y + camY) * s.p;

      const cool = s.tint < 0.33;
      const warm = s.tint > 0.72;
      const col = cool ? `rgba(180,220,255,${a})` : warm ? `rgba(255,220,190,${a})` : `rgba(255,255,255,${a})`;

      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ---------- Colony/Worm models ----------
  function newColony(x, y, hue = rand(0, 360)) {
    const dna = {
      hue,
      chaos: rand(0.55, 1.35),
      drift: rand(0.55, 1.35),
      aura: rand(0.95, 1.75),
      temperament: ["CALM", "AGGRESSIVE", "CHAOTIC", "TOXIC"][randi(0, 3)],
      biome: ["NEON GARDEN", "DEEP SEA", "VOID BLOOM", "GLASS CAVE", "ARC STORM"][randi(0, 4)],
      style: ["COMET", "CROWN", "ARC", "SPIRAL", "DRIFT"][randi(0, 4)]
    };

    const nodes = Array.from({ length: randi(4, 7) }, () => ({
      ox: rand(-70, 70),
      oy: rand(-70, 70),
      r: rand(55, 120),
      ph: rand(0, Math.PI * 2),
      sp: rand(0.4, 1.2)
    }));

    return {
      id: Math.random().toString(16).slice(2, 6).toUpperCase(),
      x, y,
      vx: rand(-0.14, 0.14),
      vy: rand(-0.14, 0.14),
      dna,
      nodes,
      worms: [],
      shock: [],
      mutations: 0,
    };
  }

  function newWorm(col, big = false) {
    const type = ["DRIFTER", "ORBITER", "HUNTER"][randi(0, 2)];
    const segCount = big ? randi(18, 28) : randi(10, 18);
    const baseLen = big ? rand(10, 16) : rand(7, 12);

    const hue = (col.dna.hue + rand(-160, 160) + 360) % 360;

    const w = {
      id: Math.random().toString(16).slice(2, 6),
      type,
      hue,
      width: big ? rand(7, 11) : rand(4.2, 7),
      speed: big ? rand(0.38, 0.75) : rand(0.5, 1.05),
      turn: rand(0.008, 0.02) * col.dna.chaos,
      phase: rand(0, Math.PI * 2),
      segs: [],
      limbs: [],
      isBoss: false,

      orbitDir: Math.random() < 0.5 ? -1 : 1,
      orbitBias: rand(0.65, 1.35),
      orbitTight: rand(0.7, 1.5),
    };

    let px = col.x + rand(-55, 55);
    let py = col.y + rand(-55, 55);
    let ang = rand(0, Math.PI * 2);

    for (let i = 0; i < segCount; i++) {
      w.segs.push({ x: px, y: py, a: ang, len: baseLen * rand(0.85, 1.22) });
      px -= Math.cos(ang) * baseLen;
      py -= Math.sin(ang) * baseLen;
      ang += rand(-0.3, 0.3) * col.dna.chaos;
    }

    return w;
  }

  function addLimb(w, col, big = false) {
    if (!w.segs.length) return;
    const at = randi(2, w.segs.length - 3);
    w.limbs.push({
      at,
      len: big ? rand(35, 90) : rand(22, 70),
      ang: rand(-1.3, 1.3),
      wob: rand(0.7, 1.6)
    });
  }

  const colonies = [newColony(0, 0, 150)];
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], true));

  // ---------- Fit view ----------
  function zoomOutToFitAll() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pad = 560;

    for (const c of colonies) {
      minX = Math.min(minX, c.x - pad);
      minY = Math.min(minY, c.y - pad);
      maxX = Math.max(maxX, c.x + pad);
      maxY = Math.max(maxY, c.y + pad);
    }

    const bw = Math.max(240, maxX - minX);
    const bh = Math.max(240, maxY - minY);
    const fit = Math.min(W / bw, H / bh);

    zoom = clamp(fit * 0.92, 0.55, 1.6);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    camX = -cx;
    camY = -cy;
  }

  // ---------- Shockwave ----------
  function shockwave(col, strength = 1) {
    col.shock.push({ r: 0, v: 2.6 + strength * 1.2, a: 0.85, w: 2 + strength });
  }
  function gigaShock(col) {
    // layered big shock for "giant" feel
    shockwave(col, 3.0);
    setTimeout(() => shockwave(col, 2.4), 40);
    setTimeout(() => shockwave(col, 1.8), 90);
  }

  // ---------- Boss dash state ----------
  let bossRef = null;
  const bossDash = {
    tNext: rand(8, 14),   // seconds until next dash
    tLeft: 0,             // active dash time left
    vx: 0,
    vy: 0,
    angle: 0,
  };

  function startBossDash(col, boss, time) {
    // pick a dramatic dash direction (not always right)
    const head = boss.segs[0];
    const dx = head.x - col.x;
    const dy = head.y - col.y;
    const baseAng = Math.atan2(dy, dx);

    // random arc around colony + sometimes invert orbit direction
    const ang = baseAng + rand(-1.9, 1.9);
    bossDash.angle = ang;

    // strong impulse; scaled by dt later
    const impulse = rand(680, 980); // world units / sec-ish
    bossDash.vx = Math.cos(ang) * impulse;
    bossDash.vy = Math.sin(ang) * impulse;

    bossDash.tLeft = rand(0.55, 0.85);
    bossDash.tNext = rand(8, 14);

    // flip orbit direction occasionally so patterns stay varied
    if (Math.random() < 0.35) boss.orbitDir *= -1;

    gigaShock(col);
    addEvent("DASH", "Boss worm CHARGE DASH");
    whoosh();
    chord(170);
  }

  function applyBossDash(dt) {
    if (!bossRef || bossDash.tLeft <= 0) return;

    const col = colonies[0]; // boss belongs to first colony in this build
    const boss = bossRef;
    if (!col || !boss || !boss.segs?.length) { bossDash.tLeft = 0; return; }

    const head = boss.segs[0];

    // Apply impulse (dt-correct) + decay for a punchy dash that eases out
    const k = Math.pow(0.10, dt); // aggressive decay
    head.x += bossDash.vx * dt;
    head.y += bossDash.vy * dt;

    bossDash.vx *= k;
    bossDash.vy *= k;

    // add extra steering so it still "feels alive"
    head.a = lerpAngle(head.a, bossDash.angle, 0.25);

    // keep it bounded near the colony, but allow big outward arc
    const d = Math.hypot(head.x - col.x, head.y - col.y);
    const leash = 520 + 120 * col.dna.aura;
    if (d > leash) {
      // pull back slightly (so it doesn't fly off into space)
      head.x = lerp(head.x, col.x, 0.06);
      head.y = lerp(head.y, col.y, 0.06);
      bossDash.vx *= 0.65;
      bossDash.vy *= 0.65;
    }

    bossDash.tLeft -= dt;
    if (bossDash.tLeft <= 0) {
      bossDash.tLeft = 0;
      // end burst with a lighter shock
      shockwave(col, 1.2);
      blip(240, 0.08, "triangle", 0.04);
    }
  }

  // ---------- Boss / splitting / mutation ----------
  function ensureBoss() {
    if (bossSpawned) return;
    if (mcap >= 50000) {
      const c = colonies[0];
      const boss = newWorm(c, true);
      boss.isBoss = true;
      boss.width *= 1.6;
      boss.speed *= 0.72;
      boss.hue = 120;
      for (let i = 0; i < 4; i++) addLimb(boss, c, true);
      c.worms.push(boss);

      bossRef = boss;
      bossSpawned = true;

      shockwave(c, 1.4);
      addEvent("BOSS", "Boss worm emerged");
      whoosh();
    }
  }

  function trySplitByMcap() {
    while (mcap >= nextSplitAt && colonies.length < MAX_COLONIES) {
      const base = colonies[0];
      const ang = rand(0, Math.PI * 2);
      const d = rand(240, 460);

      const nc = newColony(
        base.x + Math.cos(ang) * d,
        base.y + Math.sin(ang) * d,
        (base.dna.hue + rand(-90, 90) + 360) % 360
      );

      const g = growthScore();
      const starters = clamp(Math.floor(2 + g / 2), 2, 7);
      for (let i = 0; i < starters; i++) nc.worms.push(newWorm(nc, Math.random() < 0.25));

      shockwave(nc, 1.1);
      colonies.push(nc);

      addEvent("EVENT", `New colony spawned at ${fmt(nextSplitAt)} MC`);
      nextSplitAt += MC_STEP;
      chord(200);
    }
  }

  function mutateRandom() {
    const c = colonies[randi(0, colonies.length - 1)];
    if (!c?.worms?.length) return;

    const w = c.worms[randi(0, c.worms.length - 1)];
    const r = Math.random();

    const rare = Math.random() < 0.06;
    if (rare) {
      w.hue = (w.hue + rand(160, 260)) % 360;
      w.width = clamp(w.width * rand(1.10, 1.35), 3.5, 18);
      w.speed *= rand(1.05, 1.20);
      addLimb(w, c, true);
      c.mutations++;
      addEvent("MUTATION", `Rare mutation • Prism shift • Worm ${w.id}`);
      shockwave(c, 1.2);
      chord(280);
      return;
    }

    if (r < 0.30) {
      w.hue = (w.hue + rand(30, 140)) % 360;
      addEvent("MUTATION", `Color shift • Worm ${w.id}`);
    } else if (r < 0.56) {
      w.speed *= rand(1.05, 1.25);
      addEvent("MUTATION", `Aggression spike • Worm ${w.id}`);
    } else if (r < 0.78) {
      w.width = clamp(w.width * rand(1.05, 1.25), 3.5, 16);
      addEvent("MUTATION", `Body growth • Worm ${w.id}`);
    } else {
      addLimb(w, c, Math.random() < 0.35);
      addEvent("MUTATION", `Limb growth • Worm ${w.id}`);
    }

    c.mutations++;
    if (Math.random() < 0.22) shockwave(c, 0.9);
  }

  // ---------- Worm population scaling ----------
  let mutTimer = 0;
  let spawnTimer = 0;

  function maybeSpawnWorms(dt) {
    const g = growthScore();
    const target = clamp(Math.floor(3 + g * 2.0), 3, 96);
    const total = colonies.reduce((a, c) => a + c.worms.length, 0);
    if (total >= target) return;

    spawnTimer += dt;
    const rate = clamp(1.25 - g * 0.04, 0.16, 1.25);

    if (spawnTimer >= rate) {
      spawnTimer = 0;
      const c = colonies[selected] || colonies[0];
      c.worms.push(newWorm(c, Math.random() < 0.18));
      if (Math.random() < 0.35) shockwave(c, 0.6);
      addEvent("HATCH", "New worm hatched");
    }
  }

  // ---------- Controls ----------
  function bind(action, fn) {
    const btn = document.querySelector(`button[data-action="${action}"]`);
    if (btn) btn.addEventListener("click", fn);
  }

  bind("feed", () => { volume += rand(20, 90); mcap += rand(120, 460); blip(320, 0.06, "triangle", 0.03); });
  bind("smallBuy", () => { buyers += 1; volume += rand(180, 900); mcap += rand(900, 3200); blip(420, 0.06, "sine", 0.03); });
  bind("whaleBuy", () => { buyers += randi(2, 5); volume += rand(2500, 8500); mcap += rand(9000, 22000); shockwave(colonies[0], 1.2); chord(160); });
  bind("sell", () => { volume = Math.max(0, volume - rand(600, 2600)); mcap = Math.max(0, mcap - rand(2200, 9000)); blip(180, 0.07, "sawtooth", 0.03); });
  bind("storm", () => { volume += rand(5000, 18000); mcap += rand(2000, 8000); shockwave(colonies[0], 1.0); whoosh(); });
  bind("mutate", () => mutateRandom());

  bind("focus", () => {
    focusOn = !focusOn;
    const btn = $("focusBtn");
    if (btn) btn.textContent = `Focus: ${focusOn ? "On" : "Off"}`;
    if (focusOn) centerOnSelected(false);
    blip(260, 0.05, "sine", 0.03);
  });

  bind("zoomIn", () => { zoom = clamp(zoom * 1.12, 0.55, 2.6); blip(540, 0.04, "sine", 0.02); });
  bind("zoomOut", () => { zoom = clamp(zoom * 0.88, 0.55, 2.6); blip(220, 0.04, "sine", 0.02); });

  bind("capture", () => {
    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "worm_colony.png";
      a.click();
      setToast("Capture saved");
      blip(720, 0.06, "triangle", 0.03);
    } catch {
      setToast("Capture blocked — screenshot instead");
    }
  });

  bind("reset", () => location.reload());

  bind("labels", () => {
    labelsOn = !labelsOn;
    const btn = $("labelsBtn");
    if (btn) btn.textContent = `Labels: ${labelsOn ? "On" : "Off"}`;
    blip(260, 0.05, "sine", 0.03);
  });

  bind("minimap", () => {
    miniMapOn = !miniMapOn;
    const btn = $("minimapBtn");
    if (btn) btn.textContent = `MiniMap: ${miniMapOn ? "On" : "Off"}`;
    if (miniMap) miniMap.classList.toggle("on", miniMapOn);
    blip(300, 0.05, "sine", 0.03);
  });

  bind("sound", () => {
    audioOn = !audioOn;
    const btn = $("soundBtn");
    if (btn) btn.textContent = `Sound: ${audioOn ? "On" : "Off"}`;
    if (audioOn) ensureAudio();
    blip(340, 0.05, "triangle", 0.03);
  });

  // ---------- Stats update ----------
  function updateStats() {
    if (elBuyers) elBuyers.textContent = String(buyers);
    if (elVolume) elVolume.textContent = fmt(volume);
    if (elMcap) elMcap.textContent = fmt(mcap);
    if (elColonies) elColonies.textContent = String(colonies.length);
    if (elWorms) {
      const total = colonies.reduce((a, c) => a + c.worms.length, 0);
      elWorms.textContent = String(total);
    }
  }

  // ---------- Rendering helpers ----------
  function aura(x, y, r, hue, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},95%,65%,${a})`);
    g.addColorStop(0.55, `hsla(${(hue+30)%360},95%,62%,${a*0.55})`);
    g.addColorStop(1, `hsla(${hue},95%,65%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // ===== Boss aura helper =====
  function bossAura(x, y, baseR, hue, time) {
    const pulse = 0.85 + 0.15 * Math.sin(time * 0.004);
    const r1 = baseR * 1.45 * pulse;
    const r2 = baseR * 2.10 * (0.92 + 0.08 * Math.sin(time * 0.002 + 2.0));

    let g = ctx.createRadialGradient(x, y, 0, x, y, r2);
    g.addColorStop(0, `hsla(${hue}, 98%, 70%, 0.18)`);
    g.addColorStop(0.35, `hsla(${(hue+40)%360}, 98%, 65%, 0.12)`);
    g.addColorStop(1, `hsla(${hue}, 98%, 60%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r2, 0, Math.PI * 2);
    ctx.fill();

    g = ctx.createRadialGradient(x, y, 0, x, y, r1);
    g.addColorStop(0, `hsla(${hue}, 98%, 70%, 0.24)`);
    g.addColorStop(0.55, `hsla(${hue}, 98%, 65%, 0.10)`);
    g.addColorStop(1, `hsla(${hue}, 98%, 60%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r1, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `hsla(${hue}, 98%, 72%, 0.50)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, baseR * 1.25 * pulse, 0, Math.PI * 2);
    ctx.stroke();
  }

  function irregularBlob(col, time) {
    const baseHue = col.dna.hue;

    if (!isInteracting) {
      for (let i = 0; i < col.nodes.length; i++) {
        const n = col.nodes[i];
        const x = col.x + n.ox + Math.sin(time * 0.001 * n.sp + n.ph) * 12;
        const y = col.y + n.oy + Math.cos(time * 0.001 * n.sp + n.ph) * 12;

        aura(x, y, n.r * 1.25, (baseHue + i * 16) % 360, 0.14);
        aura(x, y, n.r * 0.85, (baseHue + i * 21 + 40) % 360, 0.10);
      }
      aura(col.x, col.y, 160 * col.dna.aura, baseHue, 0.10);
      aura(col.x, col.y, 110 * col.dna.aura, (baseHue + 40) % 360, 0.08);
    } else {
      aura(col.x, col.y, 145 * col.dna.aura, baseHue, 0.08);
    }

    const R = 135;
    ctx.strokeStyle = `hsla(${baseHue}, 90%, 65%, .28)`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.001; a += Math.PI / 20) {
      const wob =
        Math.sin(a * 3 + time * 0.0016) * 10 +
        Math.sin(a * 7 - time * 0.0010) * 6;
      const rr = R + wob * col.dna.chaos;
      const px = col.x + Math.cos(a) * rr;
      const py = col.y + Math.sin(a) * rr;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  function drawWorm(w, time) {
    const pts = w.segs;
    if (!pts || pts.length < 2) return;
    const head = pts[0];

    // Boss mega aura
    if (w.isBoss && !isInteracting) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      bossAura(head.x, head.y, 120, w.hue, time);
      ctx.restore();
    }

    // glow
    if (!isInteracting) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `hsla(${w.hue}, 92%, 62%, ${w.isBoss ? 0.36 : 0.14})`;
      ctx.lineWidth = w.width + (w.isBoss ? 14 : 6);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    // core
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `hsla(${w.hue}, 95%, 65%, ${w.isBoss ? 0.99 : 0.9})`;
    ctx.lineWidth = w.width + (w.isBoss ? 1.2 : 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    // beads
    if (!isInteracting) {
      const step = w.isBoss ? 2 : 4;
      for (let i = 0; i < pts.length; i += step) {
        const p = pts[i];
        const rr = Math.max(2.0, w.width * (w.isBoss ? 0.52 : 0.34));
        ctx.fillStyle = `hsla(${(w.hue + 20) % 360}, 95%, 66%, ${w.isBoss ? 0.92 : 0.78})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // limbs
    if (w.limbs?.length) {
      ctx.globalCompositeOperation = isInteracting ? "source-over" : "lighter";
      for (const L of w.limbs) {
        const at = clamp(L.at, 0, pts.length - 1);
        const base = pts[at];

        const baseAng =
          (pts[at]?.a || 0) +
          L.ang +
          Math.sin(time * 0.002 * L.wob + w.phase) * (w.isBoss ? 0.55 : 0.35);

        const lx = base.x + Math.cos(baseAng) * L.len * (w.isBoss ? 1.15 : 1);
        const ly = base.y + Math.sin(baseAng) * L.len * (w.isBoss ? 1.15 : 1);

        ctx.strokeStyle = `hsla(${(w.hue + 40) % 360}, 95%, 66%, ${isInteracting ? 0.30 : (w.isBoss ? 0.78 : 0.55)})`;
        ctx.lineWidth = Math.max(2, w.width * (w.isBoss ? 0.55 : 0.35));
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.quadraticCurveTo(
          base.x + Math.cos(baseAng) * (L.len * 0.55),
          base.y + Math.sin(baseAng) * (L.len * 0.55),
          lx,
          ly
        );
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // boss head eye + sparkles
    if (!isInteracting && w.isBoss) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `hsla(${(w.hue + 160) % 360}, 100%, 70%, 0.95)`;
      ctx.beginPath();
      ctx.arc(head.x + Math.cos(head.a) * 6, head.y + Math.sin(head.a) * 6, w.width * 0.55, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `hsla(${(w.hue + 160) % 360}, 100%, 70%, 0.22)`;
      ctx.beginPath();
      ctx.arc(head.x, head.y, w.width * 2.8, 0, Math.PI * 2);
      ctx.fill();

      const tail = pts[Math.min(pts.length - 1, 10)];
      for (let k = 0; k < 4; k++) {
        const ang = rand(0, Math.PI * 2);
        const rr = rand(0, 14);
        const sx = tail.x + Math.cos(ang) * rr;
        const sy = tail.y + Math.sin(ang) * rr;
        ctx.fillStyle = `hsla(${(w.hue + 90) % 360}, 100%, 70%, ${0.28 + 0.22 * Math.random()})`;
        ctx.beginPath();
        ctx.arc(sx, sy, rand(0.6, 1.6), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = "source-over";
    }
  }

  function drawTapRings() {
    if (!tapRings.length) return;
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    for (const r of tapRings) {
      ctx.globalAlpha = r.a;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
      r.r += 10;
      r.a *= 0.78;
    }
    ctx.globalAlpha = 1;
    for (let i = tapRings.length - 1; i >= 0; i--) {
      if (tapRings[i].a < 0.05) tapRings.splice(i, 1);
    }
  }

  function drawLabels() {
    if (!labelsOn) return;
    const alpha = clamp((zoom - 0.7) / 0.5, 0, 1);
    if (alpha <= 0.01) return;

    ctx.save();
    ctx.globalAlpha = 0.78 * alpha;
    ctx.font = "900 12px ui-sans-serif, system-ui, -apple-system, Inter";
    ctx.fillStyle = "rgba(235,245,255,.86)";
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.lineWidth = 4;

    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];
      const label = `#${i + 1} • ${c.id}`;
      const x = c.x + 18;
      const y = c.y - 18;
      ctx.strokeText(label, x, y);
      ctx.fillText(label, x, y);
    }
    ctx.restore();
  }

  // ---------- Worm behavior (fixes “rush right”) ----------
  function wormBehavior(col, w, time, dt) {
    const head = w.segs[0];

    const jitter = Math.sin(time * 0.002 + w.phase) * 0.10;
    head.a += (Math.random() - 0.5) * w.turn + jitter;

    const dx = col.x - head.x;
    const dy = col.y - head.y;
    const toward = Math.atan2(dy, dx);
    const tang = toward + w.orbitDir * (Math.PI * 0.5);

    let orbitMix = 0.08;
    let steerMix = 0.10;

    if (w.type === "DRIFTER") {
      orbitMix = 0.10 * w.orbitBias;
      steerMix = 0.08;
    } else if (w.type === "ORBITER") {
      orbitMix = 0.20 * w.orbitBias;
      steerMix = 0.07;
    } else {
      orbitMix = 0.14 * w.orbitBias;
      steerMix = 0.10;
    }

    const d = Math.hypot(head.x - col.x, head.y - col.y);
    const preferred = 150 * w.orbitTight + 60 * col.dna.aura;
    const ringPull = clamp((d - preferred) / preferred, -1, 1);

    const towardBias = clamp(0.10 + ringPull * 0.10, 0.02, 0.22);
    const tangBias = clamp(0.16 - ringPull * 0.10, 0.06, 0.30);

    const desired =
      lerpAngle(toward, tang, clamp(orbitMix + tangBias, 0, 0.55)) +
      Math.sin(time * 0.0014 + w.phase) * (w.type === "HUNTER" ? 0.20 : 0.12);

    head.a = lerpAngle(head.a, desired, clamp(steerMix + towardBias, 0.06, 0.28));

    const boost = w.isBoss ? 1.8 : 1.0;
    head.x += Math.cos(head.a) * w.speed * 2.05 * boost;
    head.y += Math.sin(head.a) * w.speed * 2.05 * boost;

    // apply boss dash impulse AFTER base movement
    // (so it stacks on top and looks explosive)
    if (w.isBoss && bossDash.tLeft > 0) {
      applyBossDash(dt);
    }

    const maxR = 330 + 60 * col.dna.aura;
    if (d > maxR) {
      const pull = (d - maxR) / maxR;
      head.x = lerp(head.x, col.x, 0.05 + pull * 0.08);
      head.y = lerp(head.y, col.y, 0.05 + pull * 0.08);
      head.a = lerpAngle(head.a, toward + w.orbitDir * 0.8, 0.14);
    }

    for (let i = 1; i < w.segs.length; i++) {
      const prev = w.segs[i - 1];
      const seg = w.segs[i];

      const vx = seg.x - prev.x;
      const vy = seg.y - prev.y;
      const ang = Math.atan2(vy, vx);

      const targetX = prev.x + Math.cos(ang) * seg.len;
      const targetY = prev.y + Math.sin(ang) * seg.len;

      seg.x = seg.x * 0.2 + targetX * 0.8;
      seg.y = seg.y * 0.2 + targetY * 0.8;
      seg.a = ang;
    }
  }

  // ---------- Mini-map ----------
  function drawMiniMap() {
    if (!miniMap || !mctx) return;

    const rect = miniMap.getBoundingClientRect();
    const mw = Math.max(1, Math.floor(rect.width));
    const mh = Math.max(1, Math.floor(rect.height));

    if (miniMap.width !== mw || miniMap.height !== mh) {
      miniMap.width = mw;
      miniMap.height = mh;
    }

    mctx.clearRect(0, 0, mw, mh);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pad = 560;
    for (const c of colonies) {
      minX = Math.min(minX, c.x - pad);
      minY = Math.min(minY, c.y - pad);
      maxX = Math.max(maxX, c.x + pad);
      maxY = Math.max(maxY, c.y + pad);
    }
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);

    const sx = mw / bw;
    const sy = mh / bh;

    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];
      const x = (c.x - minX) * sx;
      const y = (c.y - minY) * sy;

      mctx.fillStyle = i === selected ? "rgba(44,255,195,.95)" : "rgba(255,255,255,.55)";
      mctx.beginPath();
      mctx.arc(x, y, i === selected ? 3.6 : 2.4, 0, Math.PI * 2);
      mctx.fill();
    }

    const vw = (W / zoom) * sx;
    const vh = (H / zoom) * sy;
    const cx = (-camX - minX) * sx - vw / 2;
    const cy = (-camY - minY) * sy - vh / 2;

    mctx.strokeStyle = "rgba(66,165,255,.85)";
    mctx.lineWidth = 1.5;
    mctx.strokeRect(cx, cy, vw, vh);
  }

  // ---------- Step + Render ----------
  function step(dt, time) {
    ensureBoss();
    trySplitByMcap();

    // boss dash scheduler (every 8–14s)
    if (bossRef && bossDash.tLeft <= 0) {
      bossDash.tNext -= dt;
      if (bossDash.tNext <= 0) {
        startBossDash(colonies[0], bossRef, time);
      }
    }

    for (const c of colonies) {
      c.vx += rand(-0.018, 0.018) * c.dna.drift;
      c.vy += rand(-0.018, 0.018) * c.dna.drift;
      c.vx *= 0.986;
      c.vy *= 0.986;
      c.x += c.vx;
      c.y += c.vy;

      for (const s of c.shock) {
        s.r += s.v;
        s.a *= 0.96;
      }
      c.shock = c.shock.filter((s) => s.a > 0.06);
    }

    for (const c of colonies) {
      for (const w of c.worms) wormBehavior(c, w, time, dt);
    }

    if (focusOn) centerOnSelected(true);

    mutTimer += dt;
    const g = growthScore();
    const mutRate = clamp(2.1 - g * 0.08, 0.42, 2.1);
    if (mutTimer >= mutRate) {
      mutTimer = 0;
      if (Math.random() < 0.62) mutateRandom();
    }

    maybeSpawnWorms(dt);
    updateStats();
  }

  function render(time) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);

    // background
    drawBackground(time);

    // world
    ctx.scale(zoom, zoom);
    ctx.translate(camX, camY);

    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];
      irregularBlob(c, time);

      if (i === selected) {
        ctx.strokeStyle = `hsla(${c.dna.hue}, 95%, 65%, .55)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 98 * c.dna.aura, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const s of c.shock) {
        ctx.strokeStyle = `hsla(${c.dna.hue}, 92%, 62%, ${s.a})`;
        ctx.lineWidth = s.w;
        ctx.beginPath();
        ctx.arc(c.x, c.y, s.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (const c of colonies) {
      for (const w of c.worms) drawWorm(w, time);
    }

    drawTapRings();
    drawLabels();

    ctx.restore();

    if (miniMapOn && miniMap && mctx) drawMiniMap();

    if (simStatus) simStatus.textContent = "Simulation Active";
  }

  // ---------- Main loop ----------
  let last = performance.now();
  let renderAccum = 0;
  const RENDER_FPS = 40;
  const RENDER_DT = 1 / RENDER_FPS;

  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (!Number.isFinite(dt) || !Number.isFinite(now)) {
      requestAnimationFrame(tick);
      return;
    }

    step(dt, now);

    renderAccum += dt;
    if (renderAccum >= RENDER_DT) {
      renderAccum = 0;
      render(now);
    }

    requestAnimationFrame(tick);
  }

  // ---------- Boot ----------
  function boot() {
    resizeCanvas();
    initBackground();
    zoomOutToFitAll();
    updateStats();

    addEvent("EVENT", "Simulation ready");
    setToast("Tap to interact", 1100);

    requestAnimationFrame(tick);
  }

  if (document.readyState === "complete") boot();
  else window.addEventListener("load", boot, { once: true });

})();
