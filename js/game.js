(() => {
  "use strict";

  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const rad = typeof r === "number" ? r : 8;
      this.moveTo(x + rad, y);
      this.arcTo(x + w, y, x + w, y + h, rad);
      this.arcTo(x + w, y + h, x, y + h, rad);
      this.arcTo(x, y + h, x, y, rad);
      this.arcTo(x, y, x + w, y, rad);
      this.closePath();
    };
  }

  const WORLD = 2200;
  const CATCH_R = 34;
  const DETECT_R = 230;
  const PANIC_R = 110;
  const PLAYER_SPEED = 232;
  const FLEE_SPEED = 196;
  const PANIC_SPEED = 224;
  const WANDER_SPEED = 92;
  const POND_SLOW = 0.52;
  const SPRINT_MULT = 1.55;
  const TAUNTS = ["too slow", "come on", "still there?", "catch me", "this way"];
  const PANICS = ["no way😶‍🌫️", "nope😱", "hey👀", "uh"];
  const PICKUP_INFO = {
    sprint: { icon: "⚡", color: "#f3dd9d", label: "Sprint" },
    wait: { icon: "♥", color: "#e59ab3", label: "Attraction" },
    invincible: { icon: "👻", color: "#c9a6e8", label: "Invincible" },
  };

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const mini = document.getElementById("minimap");
  const mctx = mini.getContext("2d");
  const startScreen = document.getElementById("start-screen");
  const winScreen = document.getElementById("win-screen");
  const hugScene = document.getElementById("hug-scene");
  const helpScreen = document.getElementById("help-screen");
  const hud = document.getElementById("hud");
  const joystickEl = document.getElementById("joystick");
  const joyBase = document.getElementById("joy-base");
  const joyKnob = document.getElementById("joy-knob");
  const timerEl = document.getElementById("timer");
  const distanceEl = document.getElementById("distance");
  const winCopy = document.getElementById("win-copy");
  const winTimeEl = document.getElementById("win-time");
  const winBestEl = document.getElementById("win-best");
  const winMessageEl = document.getElementById("win-message");
  const winMessageBtn = document.getElementById("message-btn");
  const winNoteStatus = document.getElementById("win-note-status");

  const keys = Object.create(null);
  const joy = { x: 0, y: 0, active: false, pointerId: null };

  let dpr = 1;
  let viewW = 0;
  let viewH = 0;
  let last = 0;
  let running = false;
  let won = false;
  let pendingScore = null;
  let savedScoreId = null;
  let savePromise = null;
  let messageSent = false;
  let hugTimer = 0;
  let elapsed = 0;
  let ground = null;
  let audio = null;

  const cam = { x: 0, y: 0 };
  const petals = [];
  const sparks = [];
  const ripples = [];
  const pickups = [];
  const buffs = { sprint: 0, wait: 0, invincible: 0 };
  const sayBox = { text: "", life: 0 };
  let splashCd = 0;
  let toastTimer = 0;

  const world = {
    trees: [],
    bushes: [],
    flowers: [],
    lanterns: [],
    benches: [],
    pond: { x: 1680, y: 620, rx: 230, ry: 150 },
    plaza: { x: 1080, y: 1180, r: 168 },
    fountain: { x: 1080, y: 1180 },
  };

  const simmi = {
    name: "Simmi",
    x: 980,
    y: 1320,
    r: 16,
    facing: 0,
    moving: false,
    t: 0,
    hue: "rose",
  };

  const mausooq = {
    name: "Mausooq",
    x: 1088,
    y: 1160,
    r: 16,
    facing: Math.PI,
    moving: false,
    t: 0,
    alert: false,
    tired: 0,
    wasTired: false,
    stamina: 1,
    wp: null,
    hue: "teal",
    trickCd: 3,
    tauntCd: 2.5,
    panicCd: 0,
    wave: 0,
    dash: 0,
    hideT: 0,
    hideSpot: null,
    circleT: 0,
    circleDir: 1,
  };

  function mulberry32(seed) {
    return function rng() {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rand = mulberry32(42);

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function formatTime(sec) {
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  function inPond(x, y, pad = 0) {
    const p = world.pond;
    const dx = (x - p.x) / (p.rx + pad);
    const dy = (y - p.y) / (p.ry + pad);
    return dx * dx + dy * dy < 1;
  }

  function nearPlaza(x, y) {
    return Math.hypot(x - world.plaza.x, y - world.plaza.y) < world.plaza.r + 20;
  }

  function blocked(x, y, radius = 16) {
    if (x < 36 || y < 36 || x > WORLD - 36 || y > WORLD - 36) return true;
    for (let i = 0; i < world.trees.length; i++) {
      const t = world.trees[i];
      if (Math.hypot(x - t.x, y - t.y) < radius + t.trunk) return true;
    }
    return false;
  }

  function pickOpen(tries, minX, minY, maxX, maxY) {
    for (let i = 0; i < tries; i++) {
      const x = minX + rand() * (maxX - minX);
      const y = minY + rand() * (maxY - minY);
      if (!blocked(x, y, 22) && !nearPlaza(x, y)) return { x, y };
    }
    return { x: WORLD * 0.5, y: WORLD * 0.5 };
  }

  function generateWorld() {
    world.trees.length = 0;
    world.bushes.length = 0;
    world.flowers.length = 0;
    world.lanterns.length = 0;
    world.benches.length = 0;

    const types = ["oak", "cherry", "willow"];

    for (let i = 0; i < 86; i++) {
      const edge = i < 28;
      let x, y;
      if (edge) {
        const side = i % 4;
        if (side === 0) {
          x = 70 + rand() * (WORLD - 140);
          y = 70 + rand() * 160;
        } else if (side === 1) {
          x = 70 + rand() * (WORLD - 140);
          y = WORLD - 230 + rand() * 160;
        } else if (side === 2) {
          x = 70 + rand() * 160;
          y = 70 + rand() * (WORLD - 140);
        } else {
          x = WORLD - 230 + rand() * 160;
          y = 70 + rand() * (WORLD - 140);
        }
      } else {
        const p = pickOpen(40, 180, 180, WORLD - 180, WORLD - 180);
        x = p.x;
        y = p.y;
      }
      if (inPond(x, y, 70) || nearPlaza(x, y)) continue;
      const type = types[Math.floor(rand() * types.length)];
      world.trees.push({
        x,
        y,
        type,
        trunk: type === "willow" ? 15 : 17,
        canopy: 42 + rand() * 22,
      });
    }

    for (let i = 0; i < 48; i++) {
      const p = pickOpen(20, 120, 120, WORLD - 120, WORLD - 120);
      if (inPond(p.x, p.y, 40)) continue;
      world.bushes.push({
        x: p.x,
        y: p.y,
        s: 16 + rand() * 10,
        bloom: rand() > 0.45,
      });
    }

    for (let i = 0; i < 420; i++) {
      const x = 80 + rand() * (WORLD - 160);
      const y = 80 + rand() * (WORLD - 160);
      if (inPond(x, y, 16) || nearPlaza(x, y)) continue;
      world.flowers.push({
        x,
        y,
        c: rand() < 0.5 ? "#e59ab3" : rand() < 0.5 ? "#f3dd9d" : "#d86b8a",
        s: 2 + rand() * 2.4,
      });
    }

    const pathPts = pathPoints();
    for (let i = 8; i < pathPts.length - 8; i += 10) {
      const p = pathPts[i];
      const n = pathPts[i + 1] || p;
      const ang = Math.atan2(n.y - p.y, n.x - p.x);
      const side = i % 20 === 0 ? 1 : -1;
      world.lanterns.push({
        x: p.x + Math.cos(ang + Math.PI / 2) * 48 * side,
        y: p.y + Math.sin(ang + Math.PI / 2) * 48 * side,
      });
    }

    world.benches.push(
      { x: world.plaza.x - 150, y: world.plaza.y + 20, a: 0.2 },
      { x: world.plaza.x + 150, y: world.plaza.y - 10, a: -0.4 },
      { x: 620, y: 1680, a: 0.6 }
    );

    spawnPickups(true);

    for (let i = 0; i < 70; i++) {
      petals.push({
        x: rand() * WORLD,
        y: rand() * WORLD,
        z: 8 + rand() * 24,
        s: 3 + rand() * 4,
        sp: 12 + rand() * 22,
        drift: 18 + rand() * 30,
        rot: rand() * Math.PI * 2,
        rs: (rand() - 0.5) * 1.4,
        c: rand() > 0.3 ? "#f3c1d2" : "#fff1e4",
      });
    }
  }

  function pathPoints() {
    const pts = [];
    const nodes = [
      [1080, 1180],
      [1280, 980],
      [1500, 820],
      [1680, 880],
      [1860, 1100],
      [1700, 1420],
      [1400, 1600],
      [1080, 1680],
      [780, 1580],
      [560, 1320],
      [520, 1000],
      [720, 780],
      [980, 860],
      [1080, 1180],
    ];
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      const steps = 18;
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        pts.push({ x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t) });
      }
    }
    return pts;
  }

  function spawnOnePickup(kind) {
    let p = { x: WORLD * 0.5, y: WORLD * 0.5 };
    for (let i = 0; i < 40; i++) {
      const n = pickOpen(40, 160, 160, WORLD - 160, WORLD - 160);
      if (!inPond(n.x, n.y, 28) && !nearPlaza(n.x, n.y)) {
        p = n;
        break;
      }
    }
    pickups.push({
      kind,
      x: p.x,
      y: p.y,
      taken: false,
      respawn: 0,
      t: Math.random() * Math.PI * 2,
    });
  }

  function spawnPickups() {
    pickups.length = 0;
    ["sprint", "sprint", "wait", "wait", "invincible", "invincible"].forEach(spawnOnePickup);
  }

  function pondMul(x, y) {
    return inPond(x, y, -10) ? POND_SLOW : 1;
  }

  function mausooqSay(text, dur = 1.5) {
    sayBox.text = text;
    sayBox.life = dur;
  }

  function pickHideSpot() {
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < world.trees.length; i++) {
      const t = world.trees[i];
      const dPlayer = Math.hypot(t.x - simmi.x, t.y - simmi.y);
      const dMe = Math.hypot(t.x - mausooq.x, t.y - mausooq.y);
      if (dMe > 300 || dMe < 40 || dPlayer < 90) continue;
      const nx = (t.x - simmi.x) / dPlayer;
      const ny = (t.y - simmi.y) / dPlayer;
      const hx = t.x + nx * (t.trunk + 30);
      const hy = t.y + ny * (t.trunk + 30);
      if (!walkableProbe(hx, hy) || inPond(hx, hy, 8)) continue;
      const score = dPlayer - dMe * 0.35;
      if (score > bestScore) {
        bestScore = score;
        best = { x: hx, y: hy };
      }
    }
    return best;
  }

  function nearPondRim(x, y) {
    const p = world.pond;
    const d = Math.hypot((x - p.x) / p.rx, (y - p.y) / p.ry);
    return d > 0.72 && d < 1.55;
  }

  function paintGround() {
    const g = document.createElement("canvas");
    g.width = WORLD;
    g.height = WORLD;
    const gctx = g.getContext("2d");

    const grass = gctx.createLinearGradient(0, 0, WORLD, WORLD);
    grass.addColorStop(0, "#2f7a4e");
    grass.addColorStop(0.45, "#3c8f58");
    grass.addColorStop(1, "#2a6b47");
    gctx.fillStyle = grass;
    gctx.fillRect(0, 0, WORLD, WORLD);

    for (let i = 0; i < 280; i++) {
      gctx.fillStyle = `rgba(${30 + rand() * 40},${90 + rand() * 50},${50 + rand() * 30},${0.12 + rand() * 0.16})`;
      gctx.beginPath();
      gctx.ellipse(
        rand() * WORLD,
        rand() * WORLD,
        40 + rand() * 120,
        28 + rand() * 80,
        rand() * Math.PI,
        0,
        Math.PI * 2
      );
      gctx.fill();
    }

    gctx.strokeStyle = "rgba(70, 140, 80, 0.18)";
    gctx.lineWidth = 1;
    for (let i = 0; i < 900; i++) {
      const x = rand() * WORLD;
      const y = rand() * WORLD;
      gctx.beginPath();
      gctx.moveTo(x, y);
      gctx.lineTo(x + (rand() - 0.5) * 6, y - 6 - rand() * 8);
      gctx.stroke();
    }

    const pts = pathPoints();
    gctx.lineJoin = "round";
    gctx.lineCap = "round";
    gctx.strokeStyle = "#b9894c";
    gctx.lineWidth = 78;
    gctx.beginPath();
    gctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) gctx.lineTo(pts[i].x, pts[i].y);
    gctx.stroke();
    gctx.strokeStyle = "#d7b07a";
    gctx.lineWidth = 58;
    gctx.stroke();
    gctx.strokeStyle = "rgba(255, 236, 196, 0.28)";
    gctx.lineWidth = 18;
    gctx.stroke();

    const pl = world.plaza;
    const cob = gctx.createRadialGradient(pl.x, pl.y, 20, pl.x, pl.y, pl.r);
    cob.addColorStop(0, "#e2c9a0");
    cob.addColorStop(1, "#c9a36d");
    gctx.fillStyle = cob;
    gctx.beginPath();
    gctx.arc(pl.x, pl.y, pl.r, 0, Math.PI * 2);
    gctx.fill();
    gctx.strokeStyle = "rgba(120, 80, 40, 0.18)";
    gctx.lineWidth = 2;
    for (let r = 30; r < pl.r; r += 26) {
      gctx.beginPath();
      gctx.arc(pl.x, pl.y, r, 0, Math.PI * 2);
      gctx.stroke();
    }
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
      gctx.beginPath();
      gctx.moveTo(pl.x, pl.y);
      gctx.lineTo(pl.x + Math.cos(a) * pl.r, pl.y + Math.sin(a) * pl.r);
      gctx.stroke();
    }

    const p = world.pond;
    gctx.fillStyle = "#cbb892";
    gctx.beginPath();
    gctx.ellipse(p.x, p.y, p.rx + 22, p.ry + 18, 0.08, 0, Math.PI * 2);
    gctx.fill();
    const water = gctx.createRadialGradient(p.x - 40, p.y - 30, 20, p.x, p.y, p.rx);
    water.addColorStop(0, "#7ec8d4");
    water.addColorStop(0.45, "#3a8ea3");
    water.addColorStop(1, "#1f5e72");
    gctx.fillStyle = water;
    gctx.beginPath();
    gctx.ellipse(p.x, p.y, p.rx, p.ry, 0.08, 0, Math.PI * 2);
    gctx.fill();

    gctx.fillStyle = "#3f8a4e";
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2;
      const rr = rand() * 0.72;
      const lx = p.x + Math.cos(a) * p.rx * rr * 0.85;
      const ly = p.y + Math.sin(a) * p.ry * rr * 0.85;
      gctx.beginPath();
      gctx.ellipse(lx, ly, 16, 10, a, 0, Math.PI * 2);
      gctx.fill();
      gctx.fillStyle = "#4f9d5c";
      gctx.beginPath();
      gctx.ellipse(lx + 10, ly, 12, 8, a + 0.4, 0, Math.PI * 2);
      gctx.fill();
      gctx.fillStyle = "#3f8a4e";
    }

    for (const f of world.flowers) {
      gctx.fillStyle = f.c;
      gctx.beginPath();
      gctx.arc(f.x, f.y, f.s, 0, Math.PI * 2);
      gctx.fill();
    }

    ground = g;
  }

  function resolveSolid(e) {
    e.x = clamp(e.x, 40, WORLD - 40);
    e.y = clamp(e.y, 40, WORLD - 40);
    if (e === simmi && buffs.invincible > 0) return;

    for (let i = 0; i < world.trees.length; i++) {
      const t = world.trees[i];
      const min = e.r + t.trunk;
      const dx = e.x - t.x;
      const dy = e.y - t.y;
      const d = Math.hypot(dx, dy);
      if (d < min && d > 0.0001) {
        e.x = t.x + (dx / d) * min;
        e.y = t.y + (dy / d) * min;
      }
    }
  }

  function tryMove(e, dx, dy) {
    const ox = e.x;
    const oy = e.y;
    e.x += dx;
    e.y += dy;
    resolveSolid(e);
    if (Math.hypot(e.x - ox, e.y - oy) < 0.2 && (dx || dy)) {
      e.x = ox + dx;
      e.y = oy;
      resolveSolid(e);
      if (Math.hypot(e.x - ox, e.y - oy) < 0.2) {
        e.x = ox;
        e.y = oy + dy;
        resolveSolid(e);
      }
    }
  }

  function updatePlayer(dt) {
    let ix = joy.x;
    let iy = joy.y;
    if (keys.ArrowLeft || keys.a || keys.A) ix -= 1;
    if (keys.ArrowRight || keys.d || keys.D) ix += 1;
    if (keys.ArrowUp || keys.w || keys.W) iy -= 1;
    if (keys.ArrowDown || keys.s || keys.S) iy += 1;
    const mag = Math.hypot(ix, iy);
    if (mag > 1) {
      ix /= mag;
      iy /= mag;
    }
    simmi.moving = mag > 0.08;
    if (simmi.moving) {
      simmi.facing = Math.atan2(iy, ix);
      let spd = PLAYER_SPEED * (buffs.invincible > 0 ? 1 : pondMul(simmi.x, simmi.y));
      if (buffs.sprint > 0) spd *= SPRINT_MULT;
      tryMove(simmi, ix * spd * dt, iy * spd * dt);
    }
    simmi.t += dt;
    collectPickups(dt);
    maybeSplash(simmi);
    maybeSplash(mausooq);
  }

  function applyPickup(kind) {
    if (kind === "sprint") buffs.sprint = 2.6;
    if (kind === "wait") buffs.wait = 2;
    if (kind === "invincible") buffs.invincible = 3;
    showPickupToast(kind);
  }

  function showPickupToast(kind) {
    const el = document.getElementById("pickup-toast");
    if (!el) return;
    const info = PICKUP_INFO[kind];
    el.innerHTML = `<div class="pickup-veil"></div><div class="pickup-get"><div class="pickup-ring"></div><div class="pickup-badge" style="--c:${info.color}"><span class="toast-icon">${info.icon}</span></div><strong>${info.label}</strong></div>`;
    el.classList.remove("hidden");
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    toastTimer = 1.75;
  }

  function collectPickups(dt) {
    for (let i = 0; i < pickups.length; i++) {
      const p = pickups[i];
      p.t += dt;
      if (p.taken) {
        p.respawn -= dt;
        if (p.respawn <= 0) {
          let n = pickOpen(30, 160, 160, WORLD - 160, WORLD - 160);
          for (let k = 0; k < 20 && (inPond(n.x, n.y, 28) || nearPlaza(n.x, n.y)); k++) {
            n = pickOpen(30, 160, 160, WORLD - 160, WORLD - 160);
          }
          p.x = n.x;
          p.y = n.y;
          p.taken = false;
        }
        continue;
      }
      if (Math.hypot(p.x - simmi.x, p.y - simmi.y) < 30) {
        p.taken = true;
        p.respawn = 12 + Math.random() * 6;
        applyPickup(p.kind);
      }
    }
  }

  function maybeSplash(e) {
    if (!inPond(e.x, e.y, -10) || !e.moving) return;
    splashCd -= 0.016;
    if (splashCd > 0) return;
    splashCd = 0.18;
    ripples.push({ x: e.x, y: e.y, r: 6, a: 0.4 });
  }

  function walkableProbe(x, y) {
    return !blocked(x, y, 18);
  }

  function bestFleeAngle() {
    const base = Math.atan2(mausooq.y - simmi.y, mausooq.x - simmi.x);
    let best = base;
    let bestScore = -Infinity;
    for (let i = -6; i <= 6; i++) {
      const a = base + i * 0.38 + Math.sin(elapsed * 3.4) * 0.22;
      const look = 56;
      const nx = mausooq.x + Math.cos(a) * look;
      const ny = mausooq.y + Math.sin(a) * look;
      if (!walkableProbe(nx, ny)) continue;
      const farther = Math.hypot(nx - simmi.x, ny - simmi.y);
      const aheadOk = walkableProbe(nx + Math.cos(a) * 40, ny + Math.sin(a) * 40);
      const edge =
        nx < 180 || ny < 180 || nx > WORLD - 180 || ny > WORLD - 180 ? 160 : 0;
      const score = farther + (aheadOk ? 30 : -90) - edge;
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  }

  function updateMausooq(dt) {
    const dx = mausooq.x - simmi.x;
    const dy = mausooq.y - simmi.y;
    const dist = Math.hypot(dx, dy);

    if (dist < CATCH_R) {
      catchHim();
      return dist;
    }

    mausooq.trickCd = Math.max(0, mausooq.trickCd - dt);
    mausooq.tauntCd = Math.max(0, mausooq.tauntCd - dt);
    mausooq.panicCd = Math.max(0, mausooq.panicCd - dt);
    mausooq.wave = Math.max(0, mausooq.wave - dt);
    mausooq.dash = Math.max(0, mausooq.dash - dt);
    mausooq.hideT = Math.max(0, mausooq.hideT - dt);
    mausooq.circleT = Math.max(0, mausooq.circleT - dt);
    sayBox.life = Math.max(0, sayBox.life - dt);

    if (mausooq.tired > 0) {
      mausooq.tired -= dt;
      mausooq.wasTired = true;
    } else if (mausooq.wasTired) {
      mausooq.wasTired = false;
      mausooq.dash = 0.72;
      mausooqSay("slowass😝");
    }

    if (dist > 300 && mausooq.tauntCd <= 0) {
      mausooqSay(TAUNTS[Math.floor(Math.random() * TAUNTS.length)]);
      mausooq.tauntCd = 5 + Math.random() * 3;
    }
    if (dist < PANIC_R && mausooq.panicCd <= 0) {
      mausooqSay(PANICS[Math.floor(Math.random() * PANICS.length)], 1.1);
      mausooq.panicCd = 2.1;
    }

    if (mausooq.wave > 0 && dist < 155) {
      mausooq.wave = 0;
      mausooq.dash = 0.95;
      mausooqSay("nope😱");
    }

    if (mausooq.trickCd <= 0 && dist < DETECT_R && dist > 165 && mausooq.wave <= 0) {
      const roll = Math.random();
      if (roll < 0.3 && dist > 175 && dist < 260) {
        mausooq.wave = 0.7;
        mausooqSay("catch me babes😉");
        mausooq.trickCd = 7;
      } else if (roll < 0.58 && nearPondRim(mausooq.x, mausooq.y)) {
        mausooq.circleT = 2.1;
        mausooq.circleDir = Math.random() > 0.5 ? 1 : -1;
        mausooqSay("this way😂");
        mausooq.trickCd = 7;
      } else if (roll < 0.86) {
        const spot = pickHideSpot();
        if (spot) {
          mausooq.hideSpot = spot;
          mausooq.hideT = 2.4;
          mausooqSay("come on simmi😚");
          mausooq.trickCd = 8;
        } else {
          mausooq.trickCd = 3;
        }
      } else {
        mausooq.trickCd = 4;
      }
    }

    if (mausooq.wave > 0.08) {
      mausooq.facing = Math.atan2(simmi.y - mausooq.y, simmi.x - mausooq.x);
      mausooq.moving = false;
      mausooq.t += dt;
      if (mausooq.wave <= 0.12) mausooq.dash = Math.max(mausooq.dash, 0.85);
      return dist;
    }

    let ang;
    let spd;
    if (mausooq.hideT > 0 && mausooq.hideSpot) {
      mausooq.alert = true;
      const hx = mausooq.hideSpot.x - mausooq.x;
      const hy = mausooq.hideSpot.y - mausooq.y;
      if (dist < 140) {
        mausooq.hideT = 0;
        mausooq.dash = 0.9;
        mausooqSay("run faster babes😏");
        ang = bestFleeAngle();
        spd = PANIC_SPEED;
      } else if (Math.hypot(hx, hy) < 18) {
        mausooq.moving = false;
        mausooq.t += dt;
        return dist;
      } else {
        ang = Math.atan2(hy, hx);
        spd = FLEE_SPEED;
      }
    } else if (mausooq.circleT > 0) {
      mausooq.alert = true;
      const p = world.pond;
      const a = Math.atan2(mausooq.y - p.y, mausooq.x - p.x) + mausooq.circleDir * 0.9;
      ang = Math.atan2(
        p.y + Math.sin(a) * (p.ry + 46) - mausooq.y,
        p.x + Math.cos(a) * (p.rx + 46) - mausooq.x
      );
      spd = FLEE_SPEED + 8;
    } else if (dist < DETECT_R) {
      mausooq.alert = true;
      ang = bestFleeAngle();
      mausooq.stamina -= dt * 0.22;
      if (mausooq.stamina <= 0) {
        mausooq.tired = 0.85;
        mausooq.stamina = 1;
      }
      spd = dist < PANIC_R ? PANIC_SPEED : mausooq.tired > 0 ? 168 : FLEE_SPEED;
    } else if (dist > 520) {
      mausooq.alert = false;
      mausooq.stamina = Math.min(1, mausooq.stamina + dt * 0.35);
      ang = Math.atan2(simmi.y - mausooq.y, simmi.x - mausooq.x);
      spd = 150;
    } else {
      mausooq.alert = false;
      mausooq.stamina = Math.min(1, mausooq.stamina + dt * 0.35);
      if (!mausooq.wp || Math.hypot(mausooq.x - mausooq.wp.x, mausooq.y - mausooq.wp.y) < 40) {
        const around = pickOpen(
          24,
          clamp(simmi.x - 380, 120, WORLD - 120),
          clamp(simmi.y - 380, 120, WORLD - 120),
          clamp(simmi.x + 380, 120, WORLD - 120),
          clamp(simmi.y + 380, 120, WORLD - 120)
        );
        mausooq.wp = around;
      }
      ang = Math.atan2(mausooq.wp.y - mausooq.y, mausooq.wp.x - mausooq.x);
      spd = WANDER_SPEED;
    }

    if (mausooq.dash > 0) spd = Math.max(spd, 286);
    if (dist < 80 && mausooq.dash <= 0 && buffs.wait <= 0) {
      ang += Math.sin(elapsed * 10) * 0.32;
    }
    if (buffs.wait > 0) spd *= 0.28;
    spd *= pondMul(mausooq.x, mausooq.y);

    const vx = Math.cos(ang) * spd * dt;
    const vy = Math.sin(ang) * spd * dt;
    const beforeX = mausooq.x;
    const beforeY = mausooq.y;
    tryMove(mausooq, vx, vy);
    const moved = Math.hypot(mausooq.x - beforeX, mausooq.y - beforeY);
    mausooq.moving = moved > 0.4;
    if (mausooq.moving) mausooq.facing = Math.atan2(mausooq.y - beforeY, mausooq.x - beforeX);
    mausooq.t += dt;
    if (moved < 0.3 && mausooq.alert && mausooq.hideT <= 0) {
      const kick = bestFleeAngle() + Math.PI / 2;
      tryMove(mausooq, Math.cos(kick) * spd * dt, Math.sin(kick) * spd * dt);
    }
    return dist;
  }

  function catchHim() {
    if (won) return;
    won = true;
    running = false;
    burstHearts();
    playCatch();
    const bestKey = "simmi-chase-best";
    const prev = Number(localStorage.getItem(bestKey) || 0);
    if (!prev || elapsed < prev) localStorage.setItem(bestKey, String(elapsed));
    pendingScore = elapsed;
    savedScoreId = null;
    messageSent = false;
    savePromise = persistCatch(elapsed);
    if (winMessageEl) winMessageEl.value = "";
    setNoteStatus("");
    if (winMessageBtn) {
      winMessageBtn.disabled = false;
      winMessageBtn.textContent = "Submit";
    }
    const best = Number(localStorage.getItem(bestKey) || elapsed);
    winTimeEl.textContent = formatTime(elapsed);
    winBestEl.textContent = formatTime(best);
    winCopy.textContent =
      elapsed < 25
        ? "Damn simmi, you're too fast. He barely took two steps."
        : elapsed < 50
          ? "You finally caught him, now thats true love."
          : "He made you work for it - and you still caught him.";
    hud.classList.add("hidden");
    joystickEl.classList.add("hidden");
    playHugThenWin();
  }

  function playHugThenWin() {
    clearTimeout(hugTimer);
    hugScene.classList.remove("hidden");
    hugScene.classList.remove("show");
    hugScene.setAttribute("aria-hidden", "false");
    void hugScene.offsetWidth;
    hugScene.classList.add("show");
    hugTimer = setTimeout(showWinCard, 2400);
  }

  function hideHug() {
    clearTimeout(hugTimer);
    hugScene.classList.remove("show");
    hugScene.classList.add("hidden");
    hugScene.setAttribute("aria-hidden", "true");
  }

  function showWinCard() {
    hideHug();
    winScreen.classList.remove("hidden");
    winScreen.removeAttribute("hidden");
    winScreen.setAttribute("aria-hidden", "false");
  }

  function burstHearts() {
    for (let i = 0; i < 28; i++) {
      sparks.push({
        x: (simmi.x + mausooq.x) / 2,
        y: (simmi.y + mausooq.y) / 2 - 20,
        vx: (Math.random() - 0.5) * 140,
        vy: -40 - Math.random() * 120,
        life: 1,
        c: Math.random() > 0.5 ? "#e59ab3" : "#f3dd9d",
      });
    }
  }

  function updateFx(dt) {
    for (const p of petals) {
      p.y += p.sp * dt;
      p.x += Math.sin(elapsed * 0.7 + p.rot) * p.drift * dt;
      p.rot += p.rs * dt;
      if (p.y > WORLD + 20) {
        p.y = -10;
        p.x = rand() * WORLD;
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 40 * dt;
      s.life -= dt * 0.7;
      if (s.life <= 0) sparks.splice(i, 1);
    }
    if (Math.random() < dt * 1.6) {
      const p = world.pond;
      ripples.push({
        x: p.x + (Math.random() - 0.5) * p.rx * 1.2,
        y: p.y + (Math.random() - 0.5) * p.ry * 1.2,
        r: 4,
        a: 0.35,
      });
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.r += 22 * dt;
      r.a -= 0.22 * dt;
      if (r.a <= 0) ripples.splice(i, 1);
    }
  }

  function resize() {
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    canvas.style.width = `${viewW}px`;
    canvas.style.height = `${viewH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function cameraFollow() {
    const tx = simmi.x - viewW / 2;
    const ty = simmi.y - viewH / 2;
    cam.x = lerp(cam.x, tx, running ? 0.12 : 1);
    cam.y = lerp(cam.y, ty, running ? 0.12 : 1);
    cam.x = clamp(cam.x, 0, Math.max(0, WORLD - viewW));
    cam.y = clamp(cam.y, 0, Math.max(0, WORLD - viewH));
  }

  function drawSimmiHairBack(ctx, rear) {
    const dark = "#2b1a14";
    const mid = "#4a2e1c";
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(0, -5, 14.2, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-12, 3, 3.6, 6.5, 0.25, 0, Math.PI * 2);
    ctx.ellipse(12, 3, 3.6, 6.5, -0.25, 0, Math.PI * 2);
    ctx.fill();
    if (rear) {
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.ellipse(-4, -4, 6, 9, -0.12, 0, Math.PI * 2);
      ctx.ellipse(4, -4, 6, 9, 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSimmiHairFront(ctx, rear) {
    const dark = "#2b1a14";
    const mid = "#4a2e1c";
    const light = "#8a5a38";
    if (rear) {
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.ellipse(0, -1, 14.6, 14.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 8, 10, 7.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.ellipse(-3.5, -3, 5.5, 8, -0.12, 0, Math.PI * 2);
      ctx.ellipse(4, -2, 5, 8, 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = light;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.ellipse(-5, -8, 3, 5.5, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      drawHairFlower(ctx, 10, -8);
      return;
    }

    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(-12, -6);
    ctx.quadraticCurveTo(-9, -15, 0, -15);
    ctx.quadraticCurveTo(10, -15, 12, -6);
    ctx.quadraticCurveTo(6, -9, 0, -9);
    ctx.quadraticCurveTo(-6, -8, -12, -6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = light;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.ellipse(-3, -11, 3, 1.8, -0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    drawHairFlower(ctx, 11, -7);
  }

  function drawHairFlower(ctx, x, y) {
    ctx.fillStyle = "#f2b4c6";
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5 - 0.5;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * 3.1, y + Math.sin(a) * 3.1, 2.5, 1.55, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#f6e3a3";
    ctx.beginPath();
    ctx.arc(x, y, 1.55, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPerson(p, isYou) {
    const bob = p.moving ? Math.sin(p.t * 11) * 2.4 : Math.sin(p.t * 2.2) * 0.7;
    const stride = p.moving ? Math.sin(p.t * 11) : 0;
    const flip = Math.cos(p.facing) < 0 ? -1 : 1;
    const rear = Math.sin(p.facing) < -0.55;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1.22, 1.22);
    ctx.fillStyle = "rgba(20, 30, 24, 0.28)";
    ctx.beginPath();
    ctx.ellipse(0, 10, 16, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(0, bob - 30);
    ctx.scale(flip, 1);

    if (isYou) drawSimmiHairBack(ctx, rear);

    if (isYou) {
      ctx.fillStyle = "#e8b39a";
      ctx.fillRect(-7, 22, 5, 14 + stride * 2);
      ctx.fillRect(2, 22, 5, 14 - stride * 2);
      ctx.fillStyle = "#c45c7e";
      ctx.fillRect(-8, 35 + stride * 2, 6, 3.2);
      ctx.fillRect(1, 35 - stride * 2, 6, 3.2);
      ctx.fillStyle = "#d45d82";
      ctx.beginPath();
      ctx.moveTo(-12, 16);
      ctx.quadraticCurveTo(0, 26 + stride, 12, 16);
      ctx.lineTo(7, 8);
      ctx.lineTo(-7, 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#f0a3ba";
      ctx.fillRect(-7, 6, 14, 10);
    } else {
      ctx.fillStyle = "#2c3340";
      ctx.fillRect(-7, 20, 5, 12 + stride * 2);
      ctx.fillRect(2, 20, 5, 12 - stride * 2);
      ctx.fillStyle = "#3d7a86";
      ctx.beginPath();
      ctx.roundRect(-11, 6, 22, 18, 5);
      ctx.fill();
      ctx.fillStyle = "#f6efe2";
      ctx.fillRect(-2, 8, 4, 10);
    }

    ctx.strokeStyle = isYou ? "#e8b39a" : "#d9a588";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-10, 12);
    ctx.lineTo(-16, 18 + stride * 3);
    ctx.moveTo(10, 12);
    ctx.lineTo(16, 18 - stride * 3);
    ctx.stroke();

    if (!isYou && !rear) {
      ctx.fillStyle = "#1c1614";
      ctx.beginPath();
      ctx.ellipse(0, -2, 14, 14, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!(isYou && rear)) {
      ctx.fillStyle = isYou ? "#f0c2ab" : "#e4b496";
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#f0c2ab";
      ctx.beginPath();
      ctx.ellipse(0, 11, 4.5, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (isYou) {
      if (!rear) {
        ctx.fillStyle = "#2a1c16";
        ctx.beginPath();
        ctx.ellipse(-5, -1, 1.7, 2.4, 0, 0, Math.PI * 2);
        ctx.ellipse(5, -1, 1.7, 2.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(219, 92, 120, 0.35)";
        ctx.beginPath();
        ctx.ellipse(-7, 3, 3, 1.6, 0, 0, Math.PI * 2);
        ctx.ellipse(7, 3, 3, 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#c45c7e";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 4, 3.2, 0.15, Math.PI - 0.15);
        ctx.stroke();
      }
      drawSimmiHairFront(ctx, rear);
    } else if (rear) {
      ctx.fillStyle = "#1c1614";
      ctx.beginPath();
      ctx.ellipse(0, -2, 14, 15, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#1c1614";
      ctx.beginPath();
      ctx.ellipse(0, -8, 14, 8, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2a1c16";
      ctx.beginPath();
      ctx.ellipse(-5, -1, 1.7, 2.4, 0, 0, Math.PI * 2);
      ctx.ellipse(5, -1, 1.7, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#6d3d2a";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(1, 5, 2.6, 0.2, Math.PI - 0.6);
      ctx.stroke();
    }

    ctx.restore();

    ctx.font = "600 12px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(12, 24, 20, 0.45)";
    ctx.strokeText(p.name, p.x, p.y - 52);
    ctx.fillStyle = isYou ? "#f7d0dc" : "#cde7ec";
    ctx.fillText(p.name, p.x, p.y - 52);

    if (!isYou && (p.alert || p.wave > 0 || p.dash > 0)) {
      ctx.font = "700 16px Outfit";
      ctx.fillStyle = "#f3dd9d";
      ctx.fillText(p.tired > 0 ? "…" : p.wave > 0 ? "👋" : "!", p.x + 18, p.y - 58);
    }

    if (!isYou && sayBox.life > 0 && sayBox.text) {
      ctx.font = "600 12px Outfit, sans-serif";
      const tw = ctx.measureText(sayBox.text).width;
      const bx = p.x;
      const by = p.y - 70;
      ctx.fillStyle = "rgba(246, 239, 226, 0.94)";
      ctx.beginPath();
      ctx.roundRect(bx - tw / 2 - 8, by - 14, tw + 16, 20, 8);
      ctx.fill();
      ctx.fillStyle = "#1a2a26";
      ctx.fillText(sayBox.text, bx, by);
    }
  }

  function drawPickup(p) {
    if (p.taken) return;
    const info = PICKUP_INFO[p.kind];
    const bob = Math.sin(elapsed * 4 + p.t) * 3;
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.fillStyle = "rgba(20,30,24,0.2)";
    ctx.beginPath();
    ctx.ellipse(0, 10, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = info.color;
    ctx.beginPath();
    ctx.arc(0, -6, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath();
    ctx.arc(-3, -9, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "13px serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#1a2a26";
    ctx.fillText(info.icon, 0, -1);
    ctx.restore();
  }

  function drawTree(t) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.fillStyle = "rgba(20, 30, 24, 0.22)";
    ctx.beginPath();
    ctx.ellipse(0, 8, t.canopy * 0.55, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6a4428";
    ctx.beginPath();
    ctx.moveTo(-t.trunk * 0.55, 8);
    ctx.lineTo(t.trunk * 0.55, 8);
    ctx.lineTo(t.trunk * 0.28, -22);
    ctx.lineTo(-t.trunk * 0.28, -22);
    ctx.fill();

    const colors =
      t.type === "cherry"
        ? ["#e7a0b6", "#f0c3d2", "#d97898"]
        : t.type === "willow"
          ? ["#6ea85a", "#4e8a46", "#7eb86a"]
          : ["#2f7a45", "#24663a", "#3d8c52"];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.ellipse(
        Math.cos(i * 1.7) * 12,
        -34 + Math.sin(i * 1.3) * 10,
        t.canopy * (0.42 + (i % 3) * 0.08),
        t.canopy * 0.34,
        i,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBush(b) {
    ctx.fillStyle = "rgba(20,30,24,0.16)";
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + 6, b.s * 1.1, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2f6b3c";
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.s, b.s * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3d844c";
    ctx.beginPath();
    ctx.ellipse(b.x - 8, b.y - 2, b.s * 0.7, b.s * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (b.bloom) {
      ctx.fillStyle = "#e59ab3";
      ctx.beginPath();
      ctx.arc(b.x + 4, b.y - 6, 2.4, 0, Math.PI * 2);
      ctx.arc(b.x - 6, b.y - 2, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawLantern(l, time) {
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.fillStyle = "#5a3a24";
    ctx.fillRect(-3, -2, 6, 14);
    ctx.fillStyle = "#d7b07a";
    ctx.beginPath();
    ctx.roundRect(-8, -22, 16, 16, 3);
    ctx.fill();
    const glow = 0.22 + Math.sin(time * 3 + l.x) * 0.06;
    ctx.fillStyle = `rgba(243, 221, 157, ${glow})`;
    ctx.beginPath();
    ctx.arc(0, -14, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f3dd9d";
    ctx.beginPath();
    ctx.arc(0, -14, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBench(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a);
    ctx.fillStyle = "#7a4e2a";
    ctx.fillRect(-18, -6, 36, 7);
    ctx.fillRect(-16, 2, 5, 8);
    ctx.fillRect(11, 2, 5, 8);
    ctx.restore();
  }

  function drawFountain(time) {
    const f = world.fountain;
    ctx.fillStyle = "rgba(20,30,24,0.16)";
    ctx.beginPath();
    ctx.ellipse(f.x, f.y + 14, 48, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#cfc0a8";
    ctx.beginPath();
    ctx.ellipse(f.x, f.y + 6, 46, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5aa7b8";
    ctx.beginPath();
    ctx.ellipse(f.x, f.y + 4, 30, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ddd1bc";
    ctx.beginPath();
    ctx.ellipse(f.x, f.y - 6, 22, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7ec8d4";
    ctx.beginPath();
    ctx.ellipse(f.x, f.y - 8, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8ddd0";
    ctx.fillRect(f.x - 5, f.y - 22, 10, 16);
    ctx.beginPath();
    ctx.arc(f.x, f.y - 24, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    for (let i = 0; i < 10; i++) {
      const a = time * 3.2 + i * 0.62;
      const fall = ((time * 50 + i * 13) % 28);
      ctx.beginPath();
      ctx.arc(f.x + Math.cos(a) * (4 + fall * 0.45), f.y - 22 + fall, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawOffscreenHint() {
    const sx = mausooq.x - cam.x;
    const sy = mausooq.y - cam.y;
    if (sx > -8 && sy > -8 && sx < viewW + 8 && sy < viewH + 8) return;
    const cx = viewW * 0.5;
    const cy = viewH * 0.52;
    const ang = Math.atan2(mausooq.y - (cam.y + cy), mausooq.x - (cam.x + cx));
    const x = clamp(cx + Math.cos(ang) * (viewW * 0.38), 54, viewW - 54);
    const y = clamp(cy + Math.sin(ang) * (viewH * 0.32), 92, viewH - 110);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = "rgba(20, 51, 44, 0.78)";
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(-10, 12);
    ctx.lineTo(-10, -12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.font = "600 12px Outfit, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#cde7ec";
    ctx.fillText("Mausooq", x, y - 16);
  }

  function drawWaterFx() {
    const p = world.pond;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.rx, p.ry, 0.08, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const y = p.y - p.ry + ((elapsed * 18 + i * 40) % (p.ry * 2));
      ctx.beginPath();
      ctx.moveTo(p.x - p.rx, y);
      ctx.bezierCurveTo(p.x - 60, y + 8, p.x + 60, y - 8, p.x + p.rx, y);
      ctx.stroke();
    }
    for (const r of ripples) {
      ctx.strokeStyle = `rgba(255,255,255,${r.a})`;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.55, 0.08, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, viewW, viewH);
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    if (ground) ctx.drawImage(ground, 0, 0);
    drawWaterFx();
    drawFountain(elapsed);

    for (const b of world.benches) drawBench(b);
    for (const l of world.lanterns) drawLantern(l, elapsed);

    const sprites = [
      ...world.bushes.map((b) => ({ y: b.y, draw: () => drawBush(b) })),
      ...world.trees.map((t) => ({ y: t.y, draw: () => drawTree(t) })),
      ...pickups.filter((p) => !p.taken).map((p) => ({ y: p.y, draw: () => drawPickup(p) })),
      { y: simmi.y, draw: () => drawPerson(simmi, true) },
      { y: mausooq.y, draw: () => drawPerson(mausooq, false) },
    ];
    sprites.sort((a, b) => a.y - b.y);
    for (const s of sprites) s.draw();

    for (const p of petals) {
      const sx = p.x - cam.x;
      const sy = p.y - cam.y;
      if (sx < -20 || sy < -20 || sx > viewW + 20 || sy > viewH + 20) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    for (const s of sparks) {
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = s.c;
      ctx.font = "16px serif";
      ctx.fillText("♥", s.x, s.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    const g = ctx.createRadialGradient(
      viewW * 0.5,
      viewH * 0.45,
      viewH * 0.2,
      viewW * 0.5,
      viewH * 0.5,
      viewH * 0.85
    );
    g.addColorStop(0, "rgba(255, 214, 150, 0.05)");
    g.addColorStop(1, "rgba(12, 28, 24, 0.22)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, viewH);

    drawOffscreenHint();
    drawMinimap();
  }

  function drawMinimap() {
    const s = mini.width / WORLD;
    mctx.clearRect(0, 0, mini.width, mini.height);
    mctx.fillStyle = "#2f6b4a";
    mctx.fillRect(0, 0, mini.width, mini.height);
    mctx.fillStyle = "#3a8ea3";
    mctx.beginPath();
    mctx.ellipse(
      world.pond.x * s,
      world.pond.y * s,
      world.pond.rx * s,
      world.pond.ry * s,
      0,
      0,
      Math.PI * 2
    );
    mctx.fill();
    mctx.fillStyle = "#c9a36d";
    mctx.beginPath();
    mctx.arc(world.plaza.x * s, world.plaza.y * s, world.plaza.r * s, 0, Math.PI * 2);
    mctx.fill();
    mctx.fillStyle = "rgba(20,40,28,0.45)";
    for (const t of world.trees) {
      mctx.beginPath();
      mctx.arc(t.x * s, t.y * s, 2.2, 0, Math.PI * 2);
      mctx.fill();
    }
    for (const p of pickups) {
      if (p.taken) continue;
      mctx.fillStyle = PICKUP_INFO[p.kind].color;
      mctx.beginPath();
      mctx.arc(p.x * s, p.y * s, 2.4, 0, Math.PI * 2);
      mctx.fill();
    }
    mctx.fillStyle = "#e59ab3";
    mctx.beginPath();
    mctx.arc(simmi.x * s, simmi.y * s, 4, 0, Math.PI * 2);
    mctx.fill();
    mctx.fillStyle = "#7ec8d4";
    mctx.beginPath();
    mctx.arc(mausooq.x * s, mausooq.y * s, 4, 0, Math.PI * 2);
    mctx.fill();
  }

  function loop(ts) {
    const dt = Math.min(0.033, (ts - last) / 1000 || 0.016);
    last = ts;
    if (running) {
      elapsed += dt;
      buffs.sprint = Math.max(0, buffs.sprint - dt);
      buffs.wait = Math.max(0, buffs.wait - dt);
      buffs.invincible = Math.max(0, buffs.invincible - dt);
      if (toastTimer > 0) {
        toastTimer -= dt;
        if (toastTimer <= 0) {
          const toast = document.getElementById("pickup-toast");
          if (toast) toast.classList.add("hidden");
        }
      }
      const dist = updateMausooq(dt);
      updatePlayer(dt);
      updateFx(dt);
      cameraFollow();
      timerEl.textContent = formatTime(elapsed);
      updateBuffHud();
      if (Number.isFinite(dist)) {
        distanceEl.textContent = `${Math.max(0, Math.round((dist - CATCH_R) / 8))}m`;
        distanceEl.style.color = dist < DETECT_R ? "#f3dd9d" : "";
      }
    } else {
      updateFx(dt * 0.4);
      cameraFollow();
    }
    draw();
    requestAnimationFrame(loop);
  }

  function setKnob(x, y) {
    const max = 38;
    joyKnob.style.transform = `translate(calc(-50% + ${x * max}px), calc(-50% + ${y * max}px))`;
  }

  function joyFromEvent(e) {
    const rect = joyBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = rect.width * 0.42;
    const mag = Math.hypot(dx, dy);
    if (mag > max) {
      dx = (dx / mag) * max;
      dy = (dy / mag) * max;
    }
    joy.x = dx / max;
    joy.y = dy / max;
    setKnob(joy.x, joy.y);
  }

  function joyEnd() {
    joy.x = 0;
    joy.y = 0;
    joy.active = false;
    joy.pointerId = null;
    setKnob(0, 0);
  }

  joyBase.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    joy.active = true;
    joy.pointerId = e.pointerId;
    try {
      joyBase.setPointerCapture(e.pointerId);
    } catch (_) {
      /* synthetic events may not support capture */
    }
    joyFromEvent(e);
  });
  joyBase.addEventListener("pointermove", (e) => {
    if (!joy.active || e.pointerId !== joy.pointerId) return;
    joyFromEvent(e);
  });
  joyBase.addEventListener("pointerup", joyEnd);
  joyBase.addEventListener("pointercancel", joyEnd);

  window.addEventListener("keydown", (e) => {
    keys[e.key] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    keys[e.key] = false;
  });

  function ensureAudio() {
    if (audio) return audio;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audio = new AC();
    return audio;
  }

  function playCatch() {
    const ac = ensureAudio();
    if (!ac) return;
    const now = ac.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.08, now + 0.02 + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5 + i * 0.08);
      o.connect(g).connect(ac.destination);
      o.start(now + i * 0.08);
      o.stop(now + 0.55 + i * 0.08);
    });
  }

  function resetActors() {
    simmi.x = 980;
    simmi.y = 1320;
    simmi.facing = 0.9;
    simmi.moving = false;
    mausooq.x = 1088;
    mausooq.y = 1160;
    mausooq.facing = Math.PI;
    mausooq.alert = false;
    mausooq.tired = 0;
    mausooq.wasTired = false;
    mausooq.stamina = 1;
    mausooq.wp = null;
    mausooq.trickCd = 3;
    mausooq.tauntCd = 2.2;
    mausooq.panicCd = 0;
    mausooq.wave = 0;
    mausooq.dash = 0;
    mausooq.hideT = 0;
    mausooq.hideSpot = null;
    mausooq.circleT = 0;
    buffs.sprint = 0;
    buffs.wait = 0;
    buffs.invincible = 0;
    sayBox.text = "";
    sayBox.life = 0;
    toastTimer = 0;
    const toast = document.getElementById("pickup-toast");
    if (toast) toast.classList.add("hidden");
    elapsed = 0;
    won = false;
    cam.x = simmi.x - viewW / 2;
    cam.y = simmi.y - viewH / 2;
    sparks.length = 0;
    spawnPickups();
    updateBuffHud();
  }

  function updateBuffHud() {
    const el = document.getElementById("buffs");
    if (!el) return;
    const bits = [];
    if (buffs.sprint > 0) bits.push(`⚡ Sprint ${buffs.sprint.toFixed(1)}s`);
    if (buffs.wait > 0) bits.push(`♥ Attraction ${buffs.wait.toFixed(1)}s`);
    if (buffs.invincible > 0) bits.push(`👻 Invincible ${buffs.invincible.toFixed(1)}s`);
    el.textContent = bits.join("  ·  ");
    el.classList.toggle("hidden", bits.length === 0);
  }

  function setNoteStatus(text) {
    if (!winNoteStatus) return;
    winNoteStatus.textContent = text || "";
    winNoteStatus.classList.toggle("hidden", !text);
  }

  async function persistCatch(seconds) {
    if (!window.ChaseScores) return null;
    try {
      const result = await window.ChaseScores.save(seconds, "");
      const id = result && result.entry && result.entry.id;
      if (id != null) {
        savedScoreId = id;
        pendingScore = null;
      }
      return result;
    } catch (_) {
      return null;
    }
  }

  async function submitWinMessage() {
    if (messageSent) return true;
    if (winMessageBtn) winMessageBtn.disabled = true;
    setNoteStatus("Saving…");
    if (savePromise) await savePromise;
    const message = winMessageEl ? winMessageEl.value : "";
    if (!window.ChaseScores) {
      setNoteStatus("Could not save.");
      if (winMessageBtn) winMessageBtn.disabled = false;
      return false;
    }
    try {
      let result = null;
      if (savedScoreId != null) {
        result = await window.ChaseScores.update(savedScoreId, message);
      } else if (pendingScore != null) {
        result = await window.ChaseScores.save(pendingScore, message);
        savedScoreId = result && result.entry && result.entry.id;
        pendingScore = null;
      }
      const ok = Boolean(result && result.remote);
      messageSent = true;
      setNoteStatus(ok ? "Saved. He still won't see it." : "Saved on this phone only.");
      if (winMessageBtn) winMessageBtn.textContent = "Submitted";
      return true;
    } catch (_) {
      setNoteStatus("Could not save. Try Submit again.");
      if (winMessageBtn) winMessageBtn.disabled = false;
      return false;
    }
  }

  function flushPendingScore() {
    if (messageSent || (pendingScore == null && savedScoreId == null) || !window.ChaseScores) return;
    submitWinMessage();
  }

  async function startGame() {
    if (!messageSent && (savedScoreId != null || pendingScore != null || savePromise)) {
      await submitWinMessage();
    }
    pendingScore = null;
    savedScoreId = null;
    savePromise = null;
    messageSent = false;
    setNoteStatus("");
    if (winMessageBtn) {
      winMessageBtn.disabled = false;
      winMessageBtn.textContent = "Submit";
    }
    ensureAudio()?.resume();
    helpScreen.classList.add("hidden");
    helpScreen.setAttribute("hidden", "");
    helpScreen.setAttribute("aria-hidden", "true");
    hideHug();
    resetActors();
    running = true;
    startScreen.classList.add("hidden");
    startScreen.setAttribute("hidden", "");
    winScreen.classList.add("hidden");
    winScreen.setAttribute("hidden", "");
    winScreen.setAttribute("aria-hidden", "true");
    hud.classList.remove("hidden");
    hud.setAttribute("aria-hidden", "false");
    joystickEl.classList.remove("hidden");
    joystickEl.setAttribute("aria-hidden", "false");
    timerEl.textContent = "0:00";
  }

  function openHelp() {
    if (!helpScreen.classList.contains("hidden")) return;
    joyEnd();
    running = false;
    helpScreen.classList.remove("hidden");
    helpScreen.removeAttribute("hidden");
    helpScreen.setAttribute("aria-hidden", "false");
  }

  function closeHelp() {
    helpScreen.classList.add("hidden");
    helpScreen.setAttribute("hidden", "");
    helpScreen.setAttribute("aria-hidden", "true");
    if (!won && startScreen.classList.contains("hidden")) {
      last = performance.now();
      running = true;
    }
  }

  document.getElementById("help-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openHelp();
  });
  document.getElementById("help-close").addEventListener("click", closeHelp);
  helpScreen.addEventListener("click", (e) => {
    if (e.target === helpScreen) closeHelp();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !helpScreen.classList.contains("hidden")) closeHelp();
  });

  document.getElementById("start-btn").addEventListener("click", startGame);
  document.getElementById("again-btn").addEventListener("click", startGame);
  if (winMessageBtn) winMessageBtn.addEventListener("click", submitWinMessage);
  window.addEventListener("pagehide", flushPendingScore);

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 80));

  document.addEventListener(
    "touchmove",
    (e) => {
      if (running) e.preventDefault();
    },
    { passive: false }
  );

  generateWorld();
  paintGround();
  resize();
  resetActors();
  requestAnimationFrame(loop);
})();
