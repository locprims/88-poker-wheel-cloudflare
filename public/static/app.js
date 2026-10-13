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

  ctx.clearRect(0, 0, 900, 900);
  ctx.save();

  // Ombre extérieure
  ctx.beginPath();
  ctx.arc(c, c, 425, 0, TAU);
  ctx.shadowColor = "rgba(0,0,0,.9)";
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 15;
  ctx.fillStyle = "#050403";
  ctx.fill();
  ctx.shadowColor = "transparent";

  // Anneaux métalliques dorés
  const rim = ctx.createRadialGradient(
    c - 95, c - 120, 80, c, c, 430
  );

  rim.addColorStop(0, "#fff0a4");
  rim.addColorStop(.22, "#b87518");
  rim.addColorStop(.5, "#fff0a0");
  rim.addColorStop(.72, "#7a430c");
  rim.addColorStop(1, "#f4c55d");

  ctx.beginPath();
  ctx.arc(c, c, 424, 0, TAU);
  ctx.fillStyle = rim;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(c, c, 406, 0, TAU);
  ctx.fillStyle = "#090704";
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#f7d26e";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(c, c, 390, 0, TAU);
  ctx.lineWidth = 9;
  ctx.strokeStyle = "#9b5b12";
  ctx.stroke();

  // Ampoules lumineuses
  for (let i = 0; i < 24; i++) {
    const a = -Math.PI / 2 + i * TAU / 24;
    const x = c + 398 * Math.cos(a);
    const y = c + 398 * Math.sin(a);

    ctx.save();
    ctx.shadowColor = "#ffb526";
    ctx.shadowBlur = 18;

    const bulb = ctx.createRadialGradient(
      x - 2, y - 2, 1, x, y, 9
    );

    bulb.addColorStop(0, "#fffbe0");
    bulb.addColorStop(.35, "#ffd66a");
    bulb.addColorStop(1, "#9a5008");

    ctx.beginPath();
    ctx.arc(x, y, 7.5, 0, TAU);
    ctx.fillStyle = bulb;
    ctx.fill();
    ctx.restore();
  }

  // ========================================
  // SECTEURS DES 7 LOTS
  // ========================================

  prizes.forEach((p, i) => {
    const s = -Math.PI / 2 + i * arc;
    const e = s + arc;

    const g = ctx.createRadialGradient(
      c - 55, c - 65, 65, c, c, r
    );

    if (i % 2) {
      g.addColorStop(0, "#d9aa52");
      g.addColorStop(.52, "#9a6827");
      g.addColorStop(1, "#4b2d0b");
    } else {
      g.addColorStop(0, "#3c2b15");
      g.addColorStop(.55, "#17110a");
      g.addColorStop(1, "#050403");
    }

    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, r, s, e);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();

    // Reflet intérieur
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = .20;

    const shine = ctx.createLinearGradient(
      c - r, c - r, c + r, c + r
    );

    shine.addColorStop(0, "rgba(255,255,255,0)");
    shine.addColorStop(.5, "rgba(255,224,151,.55)");
    shine.addColorStop(1, "rgba(255,255,255,0)");

    ctx.fillStyle = shine;
    ctx.fillRect(c - r, c - r, r * 2, r * 2);
    ctx.restore();

    // Séparateurs dorés
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(
      c + r * Math.cos(s),
      c + r * Math.sin(s)
    );
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#e9bc5b";
    ctx.stroke();

    // Montants des lots
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(s + arc / 2);

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,.9)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = "#fff0bd";
    ctx.font = `900 ${p === 888 ? 48 : 54}px Arial`;

    ctx.fillText(p + " $", r - 52, 0);

    // Jackpot uniquement pour 888 $
    if (p === 888) {
      ctx.font = "900 21px Arial";
      ctx.fillStyle = "#ffd76d";
      ctx.fillText("JACKPOT", r - 57, 38);
    }

    ctx.restore();
  });

  // Anneaux intérieurs
  ctx.beginPath();
  ctx.arc(c, c, r, 0, TAU);
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#f1c55e";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(c, c, r - 10, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,239,176,.72)";
  ctx.stroke();

  // ========================================
  // MÉDAILLON CENTRAL
  // ========================================

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.9)";
  ctx.shadowBlur = 22;

  const hubRim = ctx.createRadialGradient(
    c - 20, c - 25, 8, c, c, 103
  );

  hubRim.addColorStop(0, "#fff0a4");
  hubRim.addColorStop(.35, "#d59a31");
  hubRim.addColorStop(.72, "#6f3d0b");
  hubRim.addColorStop(1, "#f0c35b");

  ctx.beginPath();
  ctx.arc(c, c, 104, 0, TAU);
  ctx.fillStyle = hubRim;
  ctx.fill();
  ctx.restore();

  const hub = ctx.createRadialGradient(
    c - 28, c - 32, 5, c, c, 91
  );

  hub.addColorStop(0, "#54401f");
  hub.addColorStop(.55, "#17110a");
  hub.addColorStop(1, "#030302");

  ctx.beginPath();
  ctx.arc(c, c, 88, 0, TAU);
  ctx.fillStyle = hub;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(c, c, 78, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,220,130,.42)";
  ctx.stroke();

  // Couronne et logo 88
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(255,183,47,.45)";
  ctx.shadowBlur = 12;
  ctx.fillStyle = "#f4cf77";

  ctx.font = "900 36px Georgia";
  ctx.fillText("♛", c, c - 37);

  ctx.font = "900 68px Georgia";
  ctx.fillText("88", c, c + 20);

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

