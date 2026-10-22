var PRIZES = [
  [8, 82],
  [18, 10],
  [28, 5],
  [38, 1],
  [48, 1],
  [88, 1],
  [888, 0]
];
var PROMO_PRIZES = [
  [28, 70],
  [38, 20],
  [48, 9],
  [88, 1],
  [888, 0]
];




function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function now() {
  return new Date().toISOString();
}

function hex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
}

function timingSafeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const theirHash = params.get("hash");
  if (!theirHash) return null;
  params.delete("hash");

  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push([key, value]);
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  const secret = await hmacSha256(
    new TextEncoder().encode("WebAppData"),
    botToken
  );
  const ours = hex(await hmacSha256(new Uint8Array(secret), dataCheckString));

  if (!timingSafeEqualHex(ours, theirHash.toLowerCase())) return null;

  try {
    const user = JSON.parse(params.get("user") || "{}");
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

async function currentUser(request, env) {
  return verifyTelegramInitData(
    request.headers.get("X-Telegram-Init-Data") || "",
    env.TELEGRAM_BOT_TOKEN || ""
  );
}

async function ensurePlayer(env, user) {
  const tid = String(user.id);
  const stamp = now();

  await env.DB.prepare(`
    INSERT INTO wheel_players
      (telegram_id, username, first_name, spins_available, updated_at)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      updated_at = excluded.updated_at
  `).bind(
    tid,
    user.username || "",
    user.first_name || "",
    stamp
  ).run();

  return env.DB.prepare(`
    SELECT telegram_id, username, first_name, spins_available, promo_30, updated_at
    FROM wheel_players
    WHERE telegram_id = ?
  `).bind(tid).first();
}

function pickPrize(isPromo = false) {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 100 + 1;
  let acc = 0;
  for (const [prize, weight] of (isPromo ? PROMO_PRIZES : PRIZES)) {
    acc += weight;
    if (n <= acc) return prize;
  }
  throw new Error("Invalid prize configuration");
}

async function apiMe(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "telegram_auth_required" }, 401);
  const player = await ensurePlayer(env, user);
  return json({ ...player, odds: Number(player.promo_30) === 1 ? PROMO_PRIZES : PRIZES });
}

async function apiSpin(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "telegram_auth_required" }, 401);

  await ensurePlayer(env, user);
  const tid = String(user.id);
  const stamp = now();

  // Consume the authorization first. The conditional UPDATE prevents two
  // simultaneous requests from using the same available spin.
  const consumed = await env.DB.prepare(`
    UPDATE wheel_players
    SET spins_available = spins_available - 1, updated_at = ?
    WHERE telegram_id = ? AND spins_available > 0
  `).bind(stamp, tid).run();

  if (!consumed.meta || consumed.meta.changes !== 1) {
    return json({ error: "no_spin_available" }, 403);
  }

  const profile = await env.DB.prepare(`SELECT promo_30 FROM wheel_players WHERE telegram_id = ?`).bind(tid).first();
  const prize = pickPrize(Number(profile?.promo_30) === 1);

  try {
    const inserted = await env.DB.prepare(`
      INSERT INTO wheel_spins (telegram_id, prize, created_at, status)
      VALUES (?, ?, ?, 'pending')
    `).bind(tid, prize, stamp).run();

    const row = await env.DB.prepare(`
      SELECT spins_available FROM wheel_players WHERE telegram_id = ?
    `).bind(tid).first();

    return json({
      prize,
      spin_id: inserted.meta?.last_row_id ?? null,
      spins_available: row?.spins_available ?? 0,
    });
  } catch (err) {
    // Restore the consumed spin if recording the result fails.
    await env.DB.prepare(`
      UPDATE wheel_players
      SET spins_available = spins_available + 1, updated_at = ?
      WHERE telegram_id = ?
    `).bind(now(), tid).run();
    throw err;
  }
}

// Telegram welcome message. Keep TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in Worker secrets.
const MINI_APP_URL = "https://88-poker-wheel-cloudflare.player-squid1.workers.dev/";
const WELCOME_IMAGE_URL = "https://88pokerclub.cc/assets/images/weelok.webp";

async function telegramWebhook(request, env) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN) {
    return json({ error: "telegram_configuration_missing" }, 503);
  }
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }
  let update;
  try { update = await request.json(); }
  catch { return json({ error: "invalid_json" }, 400); }
  const message = update.message;
  if (message?.chat?.type !== "private" ||
      !/^\/start(?:@weel_88bot)?(?:\s|$)/i.test(message.text || "")) {
    return json({ ok: true });
  }
  const form = new FormData();
  form.set("chat_id", String(message.chat.id));
  form.set("photo", WELCOME_IMAGE_URL);
  form.set("caption", "欢迎来到88扑克俱乐部！点击 PLAY，开启幸运转盘。");
  form.set("reply_markup", JSON.stringify({
    inline_keyboard: [[{ text: "▶️ PLAY", web_app: { url: MINI_APP_URL } }]]
  }));
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST", body: form
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      console.error("Telegram sendPhoto failed", response.status, result.error_code);
      return json({ error: "telegram_delivery_failed" }, 502);
    }
  } catch {
    console.error("Telegram sendPhoto request failed");
    return json({ error: "telegram_delivery_failed" }, 502);
  }
  return json({ ok: true });
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/telegram/webhook") {
        return await telegramWebhook(request, env);
      }

      if (url.pathname === "/api/me" && request.method === "GET") {
        return apiMe(request, env);
      }

      if (url.pathname === "/api/spin" && request.method === "POST") {
        return apiSpin(request, env);
      }

      if (!env.ASSETS) {
        return new Response("Static assets binding missing", { status: 500 });
      }

      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({ error: "internal_error" }, 500);
    }
  },
};    
