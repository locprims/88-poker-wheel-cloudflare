// Force Cloudflare deployment v17
const prizes = [8, 18, 28, 38, 48, 88, 888];

const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const btn = document.getElementById("spin");
const statusEl = document.getElementById("status");
const result = document.getElementById("result");

let rotation = 0;
let busy = false;

const arc = Math.PI * 2 / prizes.length;

// ========================================
// DESSIN DE LA ROULETTE
// ========================================

function draw() {
  const c = 450;
  const r = 366;
  const TAU = Math.PI * 2;
  const circle = (radius, fill) => {
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const ring = (radius, width, color) => {
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, TAU);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  };

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();

  // Thick 3D shadow beneath the metal wheel.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.95)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 19;
  circle(427, "#100903");
  ctx.restore();
  circle(430, "#2b1505");

  // Concentric metal layers, with directional highlights.
  const metal = ctx.createLinearGradient(70, 45, 835, 835);
  metal.addColorStop(0, "#fff4bc");
  metal.addColorStop(.13, "#b87319");
  metal.addColorStop(.28, "#ffe18a");
  metal.addColorStop(.46, "#76400b");
  metal.addColorStop(.64, "#ffd475");
  metal.addColorStop(.82, "#a96312");
  metal.addColorStop(1, "#fff0a3");
  circle(426, metal);
  ring(422, 4, "rgba(255,250,208,.86)");
  circle(413, "#3d2109");
  ring(409, 9, "#100b05");
  ring(402, 5, "#e8ae43");
  ring(394, 3, "#fff0b4");
  circle(386, "#100b08");

  // 24 small golden bulbs with glass highlights.
  for (let i = 0; i < 24; i++) {
    const angle = -Math.PI / 2 + i * TAU / 24;
    const x = c + 400 * Math.cos(angle);
    const y = c + 400 * Math.sin(angle);
    ctx.save();
    ctx.shadowColor = "rgba(255,170,31,.8)";
    ctx.shadowBlur = 15;
    const bulb = ctx.createRadialGradient(x - 2, y - 3, 1, x, y, 9);
    bulb.addColorStop(0, "#ffffff");
    bulb.addColorStop(.26, "#fff6c3");
    bulb.addColorStop(.65, "#ffc44c");
    bulb.addColorStop(1, "#78400a");
    ctx.beginPath();
    ctx.arc(x, y, 7.5, 0, TAU);
    ctx.fillStyle = bulb;
    ctx.fill();
    ctx.restore();
  }

  // Seven individually lit beveled sectors.
  prizes.forEach((prize, i) => {
    const start = -Math.PI / 2 + i * arc;
    const end = start + arc;
    const middle = start + arc / 2;
    const gold = i % 2 === 1;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, r, start, end);
    ctx.closePath();
    ctx.clip();

    const base = ctx.createRadialGradient(c - 90, c - 105, 40, c, c, r + 35);
    if (gold) {
      base.addColorStop(0, "#f2c76c");
      base.addColorStop(.42, "#a46b29");
      base.addColorStop(.82, "#754315");
      base.addColorStop(1, "#3e230c");
    } else {
      base.addColorStop(0, "#58432a");
      base.addColorStop(.42, "#21180f");
      base.addColorStop(.83, "#100d09");
      base.addColorStop(1, "#060504");
    }
    ctx.fillStyle = base;
    ctx.fillRect(70, 70, 760, 760);

    // Directional satin-metal sheen.
    const light = ctx.createLinearGradient(100, 90, 800, 770);
    light.addColorStop(0, "rgba(255,255,230,.30)");
    light.addColorStop(.35, "rgba(255,255,255,0)");
    light.addColorStop(.65, "rgba(255,221,130,.12)");
    light.addColorStop(1, "rgba(0,0,0,.35)");
    ctx.fillStyle = light;
    ctx.fillRect(70, 70, 760, 760);
    ctx.restore();

    // Shadow and highlight along the raised dividers.
    const ex = c + r * Math.cos(start);
    const ey = c + r * Math.sin(start);
    ctx.beginPath();
    ctx.moveTo(c + 3, c + 4);
    ctx.lineTo(ex + 3, ey + 4);
    ctx.lineWidth = 9;
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(ex, ey);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#eec56d";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c - 1, c - 1);
    ctx.lineTo(ex - 1, ey - 1);
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = "rgba(255,249,198,.85)";
    ctx.stroke();

    // Radial text: flip the left-hand side so it is never upside down.
    const textRadius = 265;
    const tx = c + textRadius * Math.cos(middle);
    const ty = c + textRadius * Math.sin(middle);
    const angle = Math.cos(middle) < 0 ? middle + Math.PI : middle;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(angle);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const amount = `${prize} $`;
    const fontSize = prize === 888 ? 45 : 53;
    ctx.font = `900 ${fontSize}px Arial`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(62,33,5,.9)";
    ctx.shadowColor = "rgba(0,0,0,.75)";
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 5;
    ctx.strokeText(amount, 0, prize === 888 ? -17 : 0);
    ctx.fillStyle = "#fff0bb";
    ctx.fillText(amount, 0, prize === 888 ? -17 : 0);
    ctx.shadowColor = "transparent";
    ctx.shadowOffsetY = 0;
    if (prize === 888) {
      ctx.font = "900 19px Arial";
      ctx.fillStyle = "#ffe18a";
      ctx.fillText("JACKPOT", 0, 30);
    }
    ctx.restore();
  });

  // Raised bevel around the inner face.
  ring(r + 7, 7, "#5c340e");
  ring(r + 2, 4, "#fff0a7");
  ring(r - 7, 2, "rgba(255,227,141,.5)");

  // Central medallion, layered like a machined gold coin.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.9)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 10;
  circle(110, "#211105");
  ctx.restore();
  const hubRim = ctx.createLinearGradient(c - 110, c - 110, c + 110, c + 110);
  hubRim.addColorStop(0, "#fff3b3");
  hubRim.addColorStop(.24, "#c38425");
  hubRim.addColorStop(.48, "#ffe398");
  hubRim.addColorStop(.75, "#865011");
  hubRim.addColorStop(1, "#efb950");
  circle(105, hubRim);
  ring(101, 3, "#fff1af");
  circle(92, "#150f09");
  const hub = ctx.createRadialGradient(c - 28, c - 35, 2, c, c, 91);
  hub.addColorStop(0, "#564021");
  hub.addColorStop(.55, "#1c150d");
  hub.addColorStop(1, "#070504");
  circle(86, hub);
  ring(80, 2, "rgba(255,219,123,.55)");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,.8)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = "#ffe2a0";
  ctx.font = "900 36px Georgia";
  ctx.fillText("♛", c, c - 36);
  ctx.font = "900 68px Georgia";
  ctx.fillText("88", c, c + 22);
  ctx.restore();
}
draw();

// ========================================
// INITIALISATION TELEGRAM
// ========================================

const tg = window.Telegram?.WebApp;

if (tg) {
  tg.ready();
  tg.expand();
}

function headers() {
  return {
    "Content-Type": "application/json",
    "X-Telegram-Init-Data": tg?.initData || ""
  };
}

// ========================================
// GESTION DES TOURS DISPONIBLES
// ========================================

let remainingSpins = 0;
let refreshSequence = 0;

function setStatusDecoration(state, icon) {
  // These elements are optional: older HTML layouts do not include them.
  const panel = document.getElementById("status-panel");
  const statusIcon = document.querySelector(".status-icon");
  if (panel) panel.dataset.state = state;
  if (statusIcon) statusIcon.textContent = icon;
}

function updateSpinStatus(count) {
  const parsed = Number(count);
  if (!Number.isFinite(parsed)) return;

  remainingSpins = Math.max(0, Math.floor(parsed));
  statusEl.textContent = remainingSpins > 0
    ? `${remainingSpins} 次抽奖机会可用`
    : "暂无抽奖机会 · 请等待审核";
  setStatusDecoration(remainingSpins > 0 ? "available" : "empty", remainingSpins > 0 ? "✓" : "🔒");
  btn.disabled = busy || remainingSpins === 0;
}

// ========================================
// CHARGEMENT DES CRÉDITS
// ========================================

async function load() {
  const sequence = ++refreshSequence;

  try {
    const r = await fetch(
      `/api/me?_=${Date.now()}`,
      {
        headers: headers(),
        cache: "no-store"
      }
    );

    const d = await r.json();

    if (!r.ok) throw d;

    if (sequence === refreshSequence) {
      updateSpinStatus(d.spins_available);
    }
  } catch (e) {
    if (sequence === refreshSequence) {
      statusEl.textContent =
        "验证失败，请稍后重试。";
      setStatusDecoration("error", "!");
      btn.disabled = true;
    }
  }
}

load();

// ========================================
// LANCEMENT DE LA ROULETTE
// ========================================

btn.addEventListener("click", async () => {
  if (busy || remainingSpins <= 0) return;

  busy = true;
  btn.disabled = true;
  result.textContent = "祝您好运…";

  ++refreshSequence;

  try {
    const r = await fetch("/api/spin", {
      method: "POST",
      headers: headers(),
      body: "{}",
      cache: "no-store"
    });

    const d = await r.json();

    if (!r.ok) throw d;

    if (!prizes.includes(Number(d.prize))) {
      throw new Error("invalid_prize");
    }

    // Mise à jour du solde
    const serverBalance = Number(d.spins_available);

    remainingSpins = Number.isFinite(serverBalance)
      ? Math.max(0, Math.floor(serverBalance))
      : Math.max(0, remainingSpins - 1);

    // Calcul de la rotation
    const idx = prizes.indexOf(Number(d.prize));
    const cur = ((rotation % 360) + 360) % 360;
    const slice = 360 / prizes.length;

    // The pointer is at 12 o’clock; sector 0 starts at -90 degrees.
    const target = (360 - (idx * slice + slice / 2)) % 360;

    const delta = (target - cur + 360) % 360;

    rotation += 360 * 7 + delta;

    canvas.style.transform = `rotate(${rotation}deg)`;

    // Fin de rotation
    setTimeout(async () => {
      result.textContent = "";

      safeCelebrate(d.prize);

      busy = false;
      updateSpinStatus(remainingSpins);

      await load();
    }, 5750);

  } catch (e) {
    result.textContent =
      e?.error === "no_spin_available"
        ? "暂无抽奖机会。"
        : "抽奖失败，请稍后重试。";

    busy = false;

    if (e?.error === "no_spin_available") {
      updateSpinStatus(0);
    } else {
      await load();
    }
  }
});

// ========================================
// ANIMATION DE VICTOIRE
// ========================================

function safeCelebrate(prize) {
  try {
    const layer = document.getElementById("celebration");
    const overlay = document.getElementById("win-overlay");
    const amount = document.getElementById("win-amount");
    const label = document.getElementById("win-label");

    if (!layer || !overlay || !amount || !label) return;

    const fx = layer.getContext("2d");

    if (!fx) return;

    const jackpot = Number(prize) === 888;

    amount.textContent = `${prize} $`;

    label.textContent = jackpot
      ? "★ JACKPOT 888 ★"
      : "★ 88 POKER CLUB ★";

    overlay.classList.remove("show", "jackpot");

    void overlay.offsetWidth;

    if (jackpot) {
      overlay.classList.add("jackpot");
    }

    overlay.classList.add("show");

    // Dimensions du canvas
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;

    layer.width = Math.max(1, Math.floor(w * dpr));
    layer.height = Math.max(1, Math.floor(h * dpr));

    fx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let particles = [];

    // Création des particules
    const burst = (x, y, count) => {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 2.5 + Math.random() * 7;

        particles.push({
          x,
          y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          life: 70 + Math.random() * 35,
          max: 105,
          size: 1.8 + Math.random() * 4.5,
          hue: 28 + Math.random() * 35,
          trail: Math.random() > .45
        });
      }
    };

    // Feux d'artifice
    burst(w * .18, h * .27, jackpot ? 125 : 80);
    burst(w * .82, h * .27, jackpot ? 125 : 80);

    setTimeout(() => {
      burst(w * .5, h * .15, jackpot ? 150 : 95);
    }, 260);

    if (jackpot) {
      setTimeout(() => {
        burst(w * .32, h * .20, 90);
        burst(w * .68, h * .20, 90);
      }, 620);
    }

    const started = performance.now();

    // Animation des particules
    function frame() {
      fx.clearRect(0, 0, w, h);
      fx.globalCompositeOperation = "lighter";

      for (const p of particles) {
        const ox = p.x;
        const oy = p.y;

        p.x += p.vx;
        p.y += p.vy;
        p.vy += .045;
        p.vx *= .994;
        p.life--;

        const alpha = Math.max(0, p.life / p.max);

        fx.globalAlpha = alpha;
        fx.strokeStyle = fx.fillStyle =
          `hsl(${p.hue},100%,62%)`;

        if (p.trail) {
          fx.lineWidth = Math.max(1, p.size * .55);
          fx.beginPath();
          fx.moveTo(ox, oy);
          fx.lineTo(
            p.x - p.vx * 2.5,
            p.y - p.vy * 2.5
          );
          fx.stroke();
        }

        fx.beginPath();
        fx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        fx.fill();
      }

      fx.globalAlpha = 1;
      fx.globalCompositeOperation = "source-over";

      particles = particles.filter(p => p.life > 0);

      if (
        (particles.length || performance.now() - started < 1700) &&
        performance.now() - started < 4300
      ) {
        requestAnimationFrame(frame);
      } else {
        fx.clearRect(0, 0, w, h);
      }
    }

    requestAnimationFrame(frame);

    // Fermeture de la fenêtre de victoire
    clearTimeout(window.__winOverlayTimer);

    window.__winOverlayTimer = setTimeout(() => {
      overlay.classList.remove("show");
    }, 3600);

  } catch (e) {
    console.error("Celebration error:", e);
  }
}
