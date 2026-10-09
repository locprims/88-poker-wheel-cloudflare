export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return Response.json({ success: true, service: "88 Poker Manager", dashboard: "/dashboard", telegramWebhook: "/telegram/webhook" });
      }

      if (request.method === "POST" && url.pathname === "/telegram/webhook") {
        const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (!secret || secret !== env.TELEGRAM_WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401 });

        const update = await request.json();

        // IMPORTANT: anti-doublon avant toute écriture métier / réponse du bot.
        if (update.update_id !== undefined) {
          const duplicate = await env.DB.prepare(
            "SELECT id FROM telegram_events WHERE telegram_update_id = ?"
          ).bind(String(update.update_id)).first();
          if (duplicate) return Response.json({ ok: true, duplicate: true });
        }

        // On réserve l'update immédiatement. Si deux requêtes identiques arrivent
        // en parallèle, l'index UNIQUE de telegram_update_id protège aussi le traitement.
        try {
          await env.DB.prepare(`
            INSERT INTO telegram_events (telegram_update_id, event_type, raw_data)
            VALUES (?, ?, ?)
          `).bind(String(update.update_id), detectEventType(update), JSON.stringify(update)).run();
        } catch (e) {
          if (String(e?.message || e).toLowerCase().includes("unique")) {
            return Response.json({ ok: true, duplicate: true });
          }
          throw e;
        }

        // /start AGT-0001 ou /start PRO-0001
        if (update.message?.chat?.type === "private" && typeof update.message?.text === "string") {
          const match = update.message.text.trim().match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/i);
          const payload = match?.[1] || "";
          const user = update.message.from;

          if (payload && user && !user.is_bot) {
            const owner = await findOwnerByCode(env, payload);

            if (owner) {
              const player = await upsertPlayer(env, user);
              await ensureOriginalAttribution(env, player.id, owner, null);

              await telegramSend(env, user.id,
                "✅ Bienvenue chez 88 Poker Club !\n\nVotre inscription est enregistrée.\nCliquez ci-dessous pour rejoindre notre groupe 👇",
                { inline_keyboard: [[{ text: "♠️ Rejoindre 88 Poker Club", url: "https://t.me/Poker_Club888" }]] }
              );
            } else {
              await telegramSend(env, user.id, "❌ Ce lien de recrutement n'est plus valide.");
            }
          }
        }

        // Fallback historique : si Telegram fournit réellement invite_link.
        let joinUser = null;
        let inviteLink = null;

        if (update.chat_join_request) {
          joinUser = update.chat_join_request.from;
          inviteLink = update.chat_join_request.invite_link?.invite_link || null;
        } else if (update.chat_member) {
          const oldStatus = update.chat_member.old_chat_member?.status;
          const newStatus = update.chat_member.new_chat_member?.status;
          const isJoin = ["left", "kicked"].includes(oldStatus) &&
            ["member", "administrator", "creator"].includes(newStatus);
          if (isJoin) {
            joinUser = update.chat_member.new_chat_member?.user || null;
            inviteLink = update.chat_member.invite_link?.invite_link || null;
          }
        }

        if (joinUser && !joinUser.is_bot) {
          const player = await upsertPlayer(env, joinUser);
          if (inviteLink) {
            const link = await env.DB.prepare(`
              SELECT id, owner_type, agent_id, promoter_id
              FROM invite_links WHERE telegram_invite_link = ? LIMIT 1
            `).bind(inviteLink).first();

            if (link) {
              await ensureOriginalAttribution(env, player.id, {
                type: link.owner_type,
                id: link.owner_type === "agent" ? link.agent_id : link.promoter_id
              }, link.id);
            }
          }
        }

        return Response.json({ ok: true });
      }

      // ---------- LUCKY WHEEL (Telegram WebApp) ----------
      if (request.method === "GET" && url.pathname === "/wheel") {
        return env.ASSETS ? env.ASSETS.fetch(new Request(new URL("/static/index.html", request.url), request)) : new Response("Wheel assets binding missing", {status:500});
      }

      if (request.method === "GET" && url.pathname === "/api/me") {
        const user = await wheelCurrentUser(request, env);
        if (!user) return Response.json({error:"telegram_auth_required"},{status:401});
        const player=await wheelEnsurePlayer(env,user);
        return Response.json({...player, odds: Number(player.promo_30)===1 ? WHEEL_PROMO_PRIZES : WHEEL_PRIZES});
      }

      if (request.method === "POST" && url.pathname === "/api/spin") {
        const user = await wheelCurrentUser(request, env);
        if (!user) return Response.json({error:"telegram_auth_required"},{status:401});
        await wheelEnsurePlayer(env, user);

        // D1 n'a pas SELECT ... FOR UPDATE. L'UPDATE conditionnel consomme le tour
        // de façon atomique et empêche deux requêtes simultanées d'utiliser le même tour.
        const consume = await env.DB.prepare(`
          UPDATE wheel_players
          SET spins_available=spins_available-1, updated_at=CURRENT_TIMESTAMP
          WHERE telegram_id=? AND spins_available>0
        `).bind(String(user.id)).run();
        if (!consume.meta?.changes) return Response.json({error:"no_spin_available"},{status:403});

        const profile = await env.DB.prepare(`SELECT promo_30 FROM wheel_players WHERE telegram_id=?`).bind(String(user.id)).first();
        const prize = wheelPickPrize(Number(profile?.promo_30) === 1);
        const ins = await env.DB.prepare(`
          INSERT INTO wheel_spins(telegram_id,prize,status) VALUES(?,?,'pending')
        `).bind(String(user.id), prize).run();
        const row = await env.DB.prepare(`SELECT spins_available FROM wheel_players WHERE telegram_id=?`).bind(String(user.id)).first();
        return Response.json({prize, spin_id:ins.meta?.last_row_id || null, spins_available:Number(row?.spins_available||0)});
      }

      // ---------- AUTH ----------
      if (request.method === "POST" && url.pathname === "/admin/login") {
        const form = await request.formData();
        const password = String(form.get("password") || "");
        if (!env.ADMIN_SECRET || password !== env.ADMIN_SECRET) return html(loginPage("Mot de passe incorrect."), 401);

        const expires = Math.floor(Date.now() / 1000) + 7 * 86400;
        const signature = await signSession(env.ADMIN_SECRET, String(expires));
        return new Response(null, {
          status: 303,
          headers: {
            Location: "/dashboard",
            "Set-Cookie": `admin_session=${expires}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`
          }
        });
      }

      if (request.method === "GET" && url.pathname === "/admin/logout") {
        return new Response(null, {
          status: 303,
          headers: {
            Location: "/dashboard",
            "Set-Cookie": "admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
          }
        });
      }

      const authenticated = await isAdmin(request, env);

      if (request.method === "GET" && url.pathname === "/dashboard" && !authenticated) {
        return html(loginPage());
      }

      if (url.pathname.startsWith("/admin/") &&
          !["/admin/login", "/admin/logout"].includes(url.pathname) &&
          !authenticated &&
          request.headers.get("X-Admin-Secret") !== env.ADMIN_SECRET) {
        return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }

      // ---------- ADMIN CRUD ----------
      if (request.method === "POST" && url.pathname === "/admin/create-agent") {
        const x = await input(request);
        const name = String(x.name || "").trim();
        if (!name) return apiError("Nom obligatoire");
        const code = await nextCode(env, "agents", "agent_code", "AGT");
        const r = await env.DB.prepare(`
          INSERT INTO agents (agent_code, name, telegram_username, active)
          VALUES (?, ?, ?, 1)
        `).bind(code, name, cleanUsername(x.telegram_username)).run();
        await audit(env, "agent", r.meta?.last_row_id || 0, "create", null, null, name);
        return back(request, "/dashboard", { success: true, agent_code: code, recruitment_link: referralLink(code) });
      }

      if (request.method === "POST" && url.pathname === "/admin/create-promoter") {
        const x = await input(request);
        const name = String(x.name || "").trim();
        if (!name) return apiError("Nom obligatoire");
        const code = await nextCode(env, "promoters", "promoter_code", "PRO");
        const r = await env.DB.prepare(`
          INSERT INTO promoters (promoter_code, name, telegram_username, active)
          VALUES (?, ?, ?, 1)
        `).bind(code, name, cleanUsername(x.telegram_username)).run();
        await audit(env, "promoter", r.meta?.last_row_id || 0, "create", null, null, name);
        return back(request, "/dashboard?tab=promoters", { success: true, promoter_code: code, recruitment_link: referralLink(code) });
      }

      if (request.method === "POST" && url.pathname === "/admin/update-owner") {
        const x = await input(request);
        const type = String(x.type || "");
        const id = Number(x.id);
        const name = String(x.name || "").trim();
        if (!id || !name || !["agent", "promoter"].includes(type)) return apiError("Données invalides");
        const table = type === "agent" ? "agents" : "promoters";
        const before = await env.DB.prepare(`SELECT name, telegram_username FROM ${table} WHERE id=?`).bind(id).first();
        await env.DB.prepare(`UPDATE ${table} SET name=?, telegram_username=? WHERE id=?`)
          .bind(name, cleanUsername(x.telegram_username), id).run();
        await audit(env, type, id, "update", "profile", JSON.stringify(before || {}), JSON.stringify({ name, telegram_username: cleanUsername(x.telegram_username) }));
        return back(request, `/dashboard?tab=${type === "agent" ? "agents" : "promoters"}`, { success: true });
      }

      if (request.method === "POST" && url.pathname === "/admin/toggle-owner") {
        const x = await input(request);
        const type = String(x.type || "");
        const id = Number(x.id);
        const active = Number(x.active) ? 1 : 0;
        if (!id || !["agent", "promoter"].includes(type)) return apiError("Données invalides");
        const table = type === "agent" ? "agents" : "promoters";
        await env.DB.prepare(`UPDATE ${table} SET active=? WHERE id=?`).bind(active, id).run();
        await audit(env, type, id, "update", "active", String(1-active), String(active));
        return back(request, `/dashboard?tab=${type === "agent" ? "agents" : "promoters"}`, { success: true });
      }

      if (request.method === "POST" && url.pathname === "/admin/activity") {
        const x = await input(request);
        const playerId = Number(x.player_id);
        const periodStart = String(x.period_start || "");
        const periodEnd = String(x.period_end || "");
        const hands = Math.max(0, Math.trunc(Number(x.hands_played || 0)));
        const rakeCents = toCents(x.rake);
        const pct = Number(x.agent_rake_percent || 0);

        if (!playerId || !validDate(periodStart) || !validDate(periodEnd) || periodEnd < periodStart ||
            rakeCents === null || !Number.isFinite(pct) || pct < 0 || pct > 100) return apiError("Données invalides");

        const old = await env.DB.prepare(`
          SELECT hands_played, rake_cents, agent_rake_percent FROM poker_activity
          WHERE player_id=? AND period_start=? AND period_end=?
        `).bind(playerId, periodStart, periodEnd).first();

        await env.DB.prepare(`
          INSERT INTO poker_activity (
            player_id, activity_date, period_start, period_end,
            hands_played, rake_cents, agent_rake_percent, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(player_id, period_start, period_end) DO UPDATE SET
            hands_played=excluded.hands_played,
            rake_cents=excluded.rake_cents,
            agent_rake_percent=excluded.agent_rake_percent,
            updated_at=CURRENT_TIMESTAMP
        `).bind(playerId, periodStart, periodStart, periodEnd, hands, rakeCents, pct).run();

        await audit(env, "poker_activity", playerId, old ? "update" : "create",
          `${periodStart} → ${periodEnd}`,
          old ? JSON.stringify(old) : null,
          JSON.stringify({period_start:periodStart,period_end:periodEnd,hands_played:hands,rake_cents:rakeCents,agent_rake_percent:pct})
        );
        return back(request, `/dashboard?from=${periodStart}&to=${periodEnd}&open_player=${playerId}`, { success: true });
      }

      if (request.method === "POST" && url.pathname === "/admin/rake-adjustment") {
        const x = await input(request);
        const agentId = Number(x.agent_id);
        const date = validDate(x.adjustment_date) ? x.adjustment_date : today();
        const cents = toCents(x.amount);
        if (!agentId || cents === null) return apiError("Données invalides");
        const r = await env.DB.prepare(`
          INSERT INTO rake_adjustments (agent_id, adjustment_date, amount_cents, reason)
          VALUES (?, ?, ?, ?)
        `).bind(agentId, date, cents, String(x.reason || "").trim() || null).run();
        await audit(env, "rake_adjustment", r.meta?.last_row_id || 0, "create", null, null, JSON.stringify({ agent_id: agentId, date, amount_cents: cents }));
        return back(request, "/dashboard", { success: true });
      }

      // Suppression définitive d'une seule période, sans supprimer le joueur.
      if (request.method === "POST" && url.pathname === "/admin/delete-period") {
        const x = await input(request);
        const periodId = Number(x.period_id);
        const playerId = Number(x.player_id);
        if (!Number.isSafeInteger(periodId) || periodId <= 0 ||
            !Number.isSafeInteger(playerId) || playerId <= 0) {
          return apiError("Période invalide");
        }
        const period = await env.DB.prepare(`
          SELECT id, player_id, period_start, period_end, hands_played,
                 rake_cents, agent_rake_percent
          FROM poker_activity WHERE id=? AND player_id=?
        `).bind(periodId, playerId).first();
        if (!period) return apiError("Période introuvable", 404);
        await env.DB.prepare(`DELETE FROM poker_activity WHERE id=? AND player_id=?`)
          .bind(periodId, playerId).run();
        await audit(env, "poker_activity", periodId, "delete", "period",
          JSON.stringify(period), null);
        return back(request, "/dashboard", { success: true });
      }

      if (request.method === "POST" && url.pathname === "/admin/delete-player") {
        const x = await input(request);
        const playerId = Number(x.player_id);
        if (!playerId) return apiError("Joueur invalide");
        const player = await env.DB.prepare(`SELECT id, telegram_user_id, first_name, last_name FROM players WHERE id=?`).bind(playerId).first();
        if (!player) return apiError("Joueur introuvable", 404);

        // Les événements Telegram gardent l'historique brut, mais ne pointent plus vers le joueur supprimé.
        await env.DB.prepare(`UPDATE telegram_events SET player_id=NULL WHERE player_id=?`).bind(playerId).run();
        await env.DB.prepare(`DELETE FROM poker_activity WHERE player_id=?`).bind(playerId).run();
        await env.DB.prepare(`DELETE FROM player_attributions WHERE player_id=?`).bind(playerId).run();
        await env.DB.prepare(`DELETE FROM players WHERE id=?`).bind(playerId).run();
        await audit(env, "player", playerId, "delete", null, JSON.stringify(player), null);
        return back(request, "/dashboard", { success: true });
      }

      if (request.method === "POST" && url.pathname === "/admin/delete-owner") {
        const x = await input(request);
        const type = String(x.type || "");
        const ownerId = Number(x.id);
        if (!ownerId || !["agent", "promoter"].includes(type)) return apiError("Données invalides");

        const table = type === "agent" ? "agents" : "promoters";
        const idColumn = type === "agent" ? "agent_id" : "promoter_id";
        const owner = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(ownerId).first();
        if (!owner) return apiError("Introuvable", 404);

        const attributed = (await env.DB.prepare(`SELECT DISTINCT player_id FROM player_attributions WHERE ${idColumn}=?`).bind(ownerId).all()).results;
        for (const row of attributed) {
          const playerId = Number(row.player_id);
          await env.DB.prepare(`UPDATE telegram_events SET player_id=NULL WHERE player_id=?`).bind(playerId).run();
          await env.DB.prepare(`DELETE FROM poker_activity WHERE player_id=?`).bind(playerId).run();
          await env.DB.prepare(`DELETE FROM player_attributions WHERE player_id=?`).bind(playerId).run();
          await env.DB.prepare(`DELETE FROM players WHERE id=?`).bind(playerId).run();
        }

        if (type === "agent") {
          await env.DB.prepare(`DELETE FROM rake_adjustments WHERE agent_id=?`).bind(ownerId).run();
          await env.DB.prepare(`DELETE FROM invite_links WHERE agent_id=?`).bind(ownerId).run();
        } else {
          await env.DB.prepare(`DELETE FROM invite_links WHERE promoter_id=?`).bind(ownerId).run();
        }
        await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(ownerId).run();
        await audit(env, type, ownerId, "delete", null, JSON.stringify(owner), null);
        return back(request, `/dashboard?tab=${type === "agent" ? "agents" : "promoters"}`, { success: true });
      }

      // Ancienne route conservée : renvoie maintenant le lien de recrutement fiable.
      if (request.method === "POST" && url.pathname === "/admin/create-agent-link") {
        const x = await input(request);
        const code = String(x.agent_code || "").trim();
        const agent = await env.DB.prepare(`
          SELECT id, agent_code FROM agents WHERE agent_code=? AND active=1
        `).bind(code).first();
        if (!agent) return apiError("Agent not found", 404);
        return Response.json({ success: true, agent_code: code, recruitment_link: referralLink(code) });
      }

      // ---------- LUCKY WHEEL ADMIN ----------
      if (request.method === "POST" && url.pathname === "/admin/wheel/grant") {
        const x=await input(request), tid=String(x.telegram_id||"").trim();
        if(!/^\d+$/.test(tid)) return apiError("Telegram ID invalide");
        const quantity=Number(x.quantity??1);
        if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000) return apiError("Nombre de tours invalide (1 à 1000)");
        await env.DB.prepare(`
          INSERT INTO wheel_players(telegram_id,username,first_name,spins_available,updated_at)
          VALUES(?,?,?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(telegram_id) DO UPDATE SET spins_available=wheel_players.spins_available+excluded.spins_available,updated_at=CURRENT_TIMESTAMP
        `).bind(tid,cleanUsername(x.username),String(x.first_name||"").trim()||null,quantity).run();
        return back(request,"/dashboard?tab=wheel",{success:true});
      }

      if (request.method === "POST" && url.pathname === "/admin/wheel/profile") {
        const x=await input(request), tid=String(x.telegram_id||"").trim();
        if(!/^\d+$/.test(tid)) return apiError("Telegram ID invalide");
        const enabled=String(x.promo_30||"0")==="1"?1:0;
        const updated=await env.DB.prepare(`UPDATE wheel_players SET promo_30=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?`).bind(enabled,tid).run();
        if(!updated.meta?.changes) return apiError("Joueur introuvable",404);
        return back(request,"/dashboard?tab=wheel",{success:true});
      }

      if (request.method === "POST" && url.pathname === "/admin/wheel/set-credits") {
        const x=await input(request), tid=String(x.telegram_id||"").trim(), quantity=Number(x.quantity);
        if(!/^\d+$/.test(tid)) return apiError("Telegram ID invalide");
        if(!Number.isSafeInteger(quantity)||quantity<0||quantity>1000) return apiError("Nombre de tours invalide (0 à 1000)");
        const result=await env.DB.prepare(`UPDATE wheel_players SET spins_available=?,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?`).bind(quantity,tid).run();
        if(!result.meta?.changes) return apiError("Joueur introuvable",404);
        return back(request,"/dashboard?tab=wheel",{success:true});
      }

      if (request.method === "POST" && url.pathname === "/admin/wheel/revoke") {
        const x=await input(request), tid=String(x.telegram_id||"").trim();
        if(!/^\d+$/.test(tid)) return apiError("Telegram ID invalide");
        await env.DB.prepare(`UPDATE wheel_players SET spins_available=0,updated_at=CURRENT_TIMESTAMP WHERE telegram_id=?`).bind(tid).run();
        return back(request,"/dashboard?tab=wheel",{success:true});
      }

      if (request.method === "POST" && url.pathname === "/admin/wheel/paid") {
        const x=await input(request), id=Number(x.spin_id||0);
        if(!id) return apiError("Tirage invalide");
        await env.DB.prepare(`UPDATE wheel_spins SET status='paid' WHERE id=?`).bind(id).run();
        return back(request,"/dashboard?tab=wheel&view=history",{success:true});
      }

      // ---------- DASHBOARD ----------
      if (request.method === "GET" && url.pathname === "/dashboard") {
        const from = validDate(url.searchParams.get("from")) ? url.searchParams.get("from") : "";
        const to = validDate(url.searchParams.get("to")) ? url.searchParams.get("to") : "";
        const requestedTab = url.searchParams.get("tab");
        const tab = ["agents","promoters","wheel"].includes(requestedTab) ? requestedTab : "agents";
        const openPlayer = Number(url.searchParams.get("open_player") || 0);

        if (tab === "wheel") {
          const wheelPlayers=(await env.DB.prepare(`
            SELECT p.telegram_id,p.username,p.first_name,p.spins_available,p.promo_30,p.updated_at,
                   COUNT(s.id) total_spins,COALESCE(SUM(CASE WHEN s.status='pending' THEN s.prize ELSE 0 END),0) total_won
            FROM wheel_players p LEFT JOIN wheel_spins s ON s.telegram_id=p.telegram_id
            GROUP BY p.telegram_id,p.username,p.first_name,p.spins_available,p.promo_30,p.updated_at
            ORDER BY p.updated_at DESC LIMIT 500
          `).all()).results;
          const wheelSpins=(await env.DB.prepare(`
            SELECT s.id,s.telegram_id,p.username,p.first_name,s.prize,s.created_at,s.status
            FROM wheel_spins s LEFT JOIN wheel_players p ON p.telegram_id=s.telegram_id
            ORDER BY s.id DESC LIMIT 200
          `).all()).results;
          return html(wheelDashboard({players:wheelPlayers,spins:wheelSpins,view:url.searchParams.get("view")==="history"?"history":"players"}));
        }

        const agents = (await env.DB.prepare(`SELECT * FROM agents ORDER BY id DESC`).all()).results;
        const promoters = (await env.DB.prepare(`SELECT * FROM promoters ORDER BY id DESC`).all()).results;
        const players = (await env.DB.prepare(`
          SELECT p.*, pa.owner_type, pa.agent_id, pa.promoter_id, pa.joined_at
          FROM players p JOIN player_attributions pa ON pa.player_id=p.id AND pa.is_original=1
          ORDER BY p.id DESC
        `).all()).results;

        const conditions = [], params = [];
        if (from) { conditions.push("period_end >= ?"); params.push(from); }
        if (to) { conditions.push("period_start <= ?"); params.push(to); }
        const where = conditions.length ? conditions.join(" AND ") : "1=1";
        const stmt = env.DB.prepare(`
          SELECT player_id,
            SUM(hands_played) hands_played,
            SUM(rake_cents) rake_cents,
            SUM(rake_cents*(agent_rake_percent/100.0)) commission_cents,
            CASE WHEN SUM(rake_cents) != 0
              THEN SUM(rake_cents*agent_rake_percent)/SUM(rake_cents)
              ELSE MAX(agent_rake_percent) END effective_percent
          FROM poker_activity WHERE ${where} GROUP BY player_id
        `);
        const acts = (params.length ? await stmt.bind(...params).all() : await stmt.all()).results;
        const activityMap = new Map(acts.map(a => [Number(a.player_id), a]));

        const activityPeriods = (await env.DB.prepare(`
          SELECT id, player_id, period_start, period_end, hands_played, rake_cents, agent_rake_percent,
                 ROUND(rake_cents*(agent_rake_percent/100.0)) commission_cents
          FROM poker_activity
          ORDER BY period_start DESC, period_end DESC, id DESC
        `).all()).results;

        const ac=[], ap=[];
        if (from) { ac.push("adjustment_date >= ?"); ap.push(from); }
        if (to) { ac.push("adjustment_date <= ?"); ap.push(to); }
        const astmt = env.DB.prepare(`
          SELECT agent_id, SUM(amount_cents) adjustment_cents
          FROM rake_adjustments WHERE ${ac.length ? ac.join(" AND ") : "1=1"} GROUP BY agent_id
        `);
        const adjs = (ap.length ? await astmt.bind(...ap).all() : await astmt.all()).results;
        const adjustmentMap = new Map(adjs.map(a => [Number(a.agent_id), Number(a.adjustment_cents || 0)]));

        return html(dashboard({ agents, promoters, players, activityMap, activityPeriods, adjustmentMap, from, to, tab, openPlayer }));
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error(error);
      return Response.json({ success: false, error: "Internal error", detail: String(error?.message || error) }, { status: 500 });
    }
  }
};

async function findOwnerByCode(env, code) {
  if (/^AGT-\d+$/i.test(code)) {
    const a = await env.DB.prepare(`SELECT id, agent_code code, name FROM agents WHERE agent_code=? AND active=1`).bind(code.toUpperCase()).first();
    return a ? { type: "agent", ...a } : null;
  }
  if (/^PRO-\d+$/i.test(code)) {
    const p = await env.DB.prepare(`SELECT id, promoter_code code, name FROM promoters WHERE promoter_code=? AND active=1`).bind(code.toUpperCase()).first();
    return p ? { type: "promoter", ...p } : null;
  }
  return null;
}

async function upsertPlayer(env, user) {
  await env.DB.prepare(`
    INSERT INTO players (telegram_user_id,telegram_username,first_name,last_name,updated_at)
    VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(telegram_user_id) DO UPDATE SET
      telegram_username=excluded.telegram_username, first_name=excluded.first_name,
      last_name=excluded.last_name, updated_at=CURRENT_TIMESTAMP
  `).bind(String(user.id), user.username || null, user.first_name || null, user.last_name || null).run();
  return env.DB.prepare(`SELECT id FROM players WHERE telegram_user_id=?`).bind(String(user.id)).first();
}

async function ensureOriginalAttribution(env, playerId, owner, inviteLinkId) {
  const existing = await env.DB.prepare(`
    SELECT id FROM player_attributions WHERE player_id=? AND is_original=1 LIMIT 1
  `).bind(playerId).first();
  if (existing) return false;

  await env.DB.prepare(`
    INSERT INTO player_attributions
      (player_id,owner_type,agent_id,promoter_id,invite_link_id,is_original,active)
    VALUES (?,?,?,?,?,1,1)
  `).bind(
    playerId, owner.type,
    owner.type === "agent" ? owner.id : null,
    owner.type === "promoter" ? owner.id : null,
    inviteLinkId || null
  ).run();
  await audit(env, "player_attribution", playerId, "create", null, null, `${owner.type}:${owner.id}`);
  return true;
}

async function telegramSend(env, chatId, text, reply_markup=null) {
  const body={chat_id:chatId,text}; if(reply_markup) body.reply_markup=reply_markup;
  const r=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)
  });
  if(!r.ok) console.error("Telegram sendMessage HTTP",r.status);
}

function detectEventType(u) {
  if(u.chat_member)return"chat_member"; if(u.chat_join_request)return"chat_join_request";
  if(u.my_chat_member)return"my_chat_member"; if(u.message?.new_chat_members)return"new_chat_members";
  if(u.message)return"message"; return"other";
}

async function signSession(secret, value) {
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function isAdmin(req,env){
  if(!env.ADMIN_SECRET)return false;
  const m=(req.headers.get("Cookie")||"").match(/(?:^|;\s*)admin_session=([^;]+)/);
  if(!m)return false;
  const [exp,sig]=decodeURIComponent(m[1]).split(".");
  if(!exp||!sig||Number(exp)<Math.floor(Date.now()/1000))return false;
  return sig===await signSession(env.ADMIN_SECRET,exp);
}
async function input(req){
  if((req.headers.get("content-type")||"").includes("application/json"))return req.json();
  return Object.fromEntries((await req.formData()).entries());
}
async function nextCode(env,table,column,prefix){
  const rows=(await env.DB.prepare(`SELECT ${column} code FROM ${table} WHERE ${column} LIKE ?`).bind(`${prefix}-%`).all()).results;
  let max=0; for(const r of rows){const n=Number(String(r.code||"").split("-")[1]);if(Number.isInteger(n)&&n>max)max=n;}
  return `${prefix}-${String(max+1).padStart(4,"0")}`;
}
function referralLink(code){return `https://t.me/Poker88ManagerBot?start=${encodeURIComponent(code)}`;}
async function audit(env,t,id,action,field,oldv,newv){
  try{await env.DB.prepare(`INSERT INTO audit_log(entity_type,entity_id,field_name,old_value,new_value,action) VALUES(?,?,?,?,?,?)`)
    .bind(t,Number(id||0),field||null,oldv??null,newv??null,action).run();}catch(e){console.error("audit",e);}
}
function cleanUsername(v){v=String(v||"").trim().replace(/^@/,"");return v||null;}
function validDate(v){return typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v);}
function today(){return new Date().toISOString().slice(0,10);}
function toCents(v){const n=Number(String(v??"").trim().replace(",","."));return Number.isFinite(n)?Math.round(n*100):null;}
function money(c){return `$${(Number(c||0)/100).toFixed(2)}`;}
function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function apiError(e,s=400){return Response.json({success:false,error:e},{status:s});}
function back(req,loc,data){return (req.headers.get("content-type")||"").includes("application/json")?Response.json(data):new Response(null,{status:303,headers:{Location:loc}});}
function html(s,status=200){return new Response(s,{status,headers:{"content-type":"text/html; charset=UTF-8","cache-control":"no-store"}});}

function loginPage(error=""){
return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>88 Poker Manager</title>
<style>body{margin:0;background:#0b0b0d;color:#fff;font-family:Arial;display:grid;place-items:center;min-height:100vh}.b{width:min(420px,calc(100% - 32px));background:#151518;border:1px solid #29292d;border-radius:16px;padding:28px}input,button{width:100%;box-sizing:border-box;margin-top:12px;padding:13px;border:1px solid #35353b;border-radius:9px;background:#0f0f12;color:#fff}button{cursor:pointer;font-weight:700}.e{background:#351515;padding:10px;border-radius:8px;margin-top:12px}</style></head>
<body><div class="b"><h1>88 Poker Manager</h1><p>Administration sécurisée</p>${error?`<div class="e">${esc(error)}</div>`:""}<form method="post" action="/admin/login"><input type="password" name="password" placeholder="Mot de passe ADMIN_SECRET" required autofocus><button>Se connecter</button></form></div></body></html>`;
}

function dashboard({agents,promoters,players,activityMap,activityPeriods,adjustmentMap,from,to,tab,openPlayer}){
  const children=(type,id)=>players.filter(p=>p.owner_type===type&&Number(type==="agent"?p.agent_id:p.promoter_id)===Number(id));
  const fmtDate=v=>{if(!v)return "—";const [y,m,d]=String(v).split("-");return d&&m&&y?`${d}/${m}/${y}`:String(v);};
  const periodsFor=id=>(activityPeriods||[]).filter(x=>Number(x.player_id)===Number(id));
  const periodRecaps=p=>periodsFor(p.id).map(x=>{
    const pct=Number(x.agent_rake_percent||0);
    return `<div class="period-recap"><div class="period-info"><strong>✓ ${fmtDate(x.period_start)} → ${fmtDate(x.period_end)}</strong><span>${Number(x.hands_played||0).toLocaleString("fr-FR")} mains</span><span>Rake : ${money(x.rake_cents)}</span><span>Agent : ${pct.toFixed(2)}%</span><span>Commission : ${money(x.commission_cents)}</span></div><div class="period-actions"><button type="button" class="edit-period" onclick="editPeriod(${p.id},'${esc(x.period_start)}','${esc(x.period_end)}',${Number(x.hands_played||0)},${Number(x.rake_cents||0)/100},${pct})">Modifier cette période</button><form method="post" action="/admin/delete-period" onsubmit="return confirm('Supprimer définitivement la période du ${fmtDate(x.period_start)} au ${fmtDate(x.period_end)} et toutes ses données (mains, rake, pourcentage) ?');"><input type="hidden" name="period_id" value="${x.id}"><input type="hidden" name="player_id" value="${p.id}"><button type="submit" class="danger">Supprimer période</button></form></div></div>`;
  }).join("");

  const playerRows=(type,id)=>children(type,id).map(p=>{
    const a=activityMap.get(Number(p.id))||{};
    const name=[p.first_name,p.last_name].filter(Boolean).join(" ")||"—";
    const defaultPct=Number(a.effective_percent||0).toFixed(2);
    return `<tr class="player child-row child-${type}-${id}" ${Number(openPlayer)===Number(p.id)?'style="display:table-row"':""}><td>↳ ${esc(name)}<small>TG: ${esc(p.telegram_user_id)}</small></td><td>${esc(p.poker_player_id||"—")}</td><td>${esc(p.telegram_username?"@"+p.telegram_username:"—")}</td><td>${Number(a.hands_played||0)}</td><td>${money(a.rake_cents)}</td><td>${defaultPct}%</td><td>${money(a.commission_cents)}</td><td><details ${Number(openPlayer)===Number(p.id)?"open":""}><summary>Saisir / modifier</summary><form id="activity-${p.id}" class="row" method="post" action="/admin/activity"><input type="hidden" name="player_id" value="${p.id}"><label>Du<input type="date" name="period_start" value="${esc(from||today())}" required></label><label>Au<input type="date" name="period_end" value="${esc(to||today())}" required></label><label>Mains<input type="number" min="0" name="hands_played" value="0" required></label><label>Rake $<input type="number" min="0" step=".01" name="rake" value="0" required></label><label>% agent<input type="number" min="0" max="100" step=".01" name="agent_rake_percent" value="${defaultPct}" required></label><button>Enregistrer</button></form><small>Même joueur + mêmes dates = mise à jour de la période existante.</small><details class="period-dropdown" ${Number(openPlayer)===Number(p.id)?"open":""}><summary>▶ Périodes enregistrées (${periodsFor(p.id).length})</summary><div class="period-list">${periodRecaps(p)||'<div class="no-period">Aucune période enregistrée.</div>'}</div></details></details><form method="post" action="/admin/delete-player" onsubmit="return confirm('Supprimer définitivement ce joueur et toutes ses données poker ?');"><input type="hidden" name="player_id" value="${p.id}"><button class="danger">Supprimer joueur</button></form></td></tr>`;
  }).join("");

  const agentRows=agents.map(a=>{
    const ps=children("agent",a.id);let hands=0,rake=0,comm=0;
    ps.forEach(p=>{const x=activityMap.get(Number(p.id))||{};hands+=Number(x.hands_played||0);rake+=Number(x.rake_cents||0);comm+=Number(x.commission_cents||0);});
    const adj=Number(adjustmentMap.get(Number(a.id))||0), total=rake+adj, pct=rake?comm/rake*100:0;
    return `<tr class="owner ${a.active?"":"off"}"><td><strong>${esc(a.name)}</strong><small>${esc(a.agent_code)}</small></td><td>${esc(a.telegram_username?"@"+String(a.telegram_username).replace(/^@/,""):"—")}</td><td>${ps.length}</td><td>${hands}</td><td>${money(total)}${adj?`<small>Ajust.: ${money(adj)}</small>`:""}</td><td>${pct.toFixed(2)}%</td><td>${money(comm)}</td><td><button type="button" onclick="togglePlayers('agent-${a.id}', this)">▶ Joueurs (${ps.length})</button> <button type="button" onclick="copyLink('${esc(referralLink(a.agent_code))}')">Copier lien</button><details><summary>Gérer</summary><form class="row" method="post" action="/admin/update-owner"><input type="hidden" name="type" value="agent"><input type="hidden" name="id" value="${a.id}"><label>Nom<input name="name" value="${esc(a.name)}" required></label><label>Telegram<input name="telegram_username" value="${esc(a.telegram_username||"")}"></label><button>Modifier</button></form><form class="row" method="post" action="/admin/rake-adjustment"><input type="hidden" name="agent_id" value="${a.id}"><label>Date<input type="date" name="adjustment_date" value="${esc(to||today())}" required></label><label>Ajustement $<input type="number" step=".01" name="amount" value="0" required></label><label>Motif<input name="reason"></label><button>Ajouter</button></form><form method="post" action="/admin/toggle-owner"><input type="hidden" name="type" value="agent"><input type="hidden" name="id" value="${a.id}"><input type="hidden" name="active" value="${a.active?0:1}"><button>${a.active?"Désactiver":"Réactiver"}</button></form><form method="post" action="/admin/delete-owner" onsubmit="return confirm('ATTENTION : supprimer cet agent supprimera aussi tous ses joueurs et leurs données poker. Continuer ?');"><input type="hidden" name="type" value="agent"><input type="hidden" name="id" value="${a.id}"><button class="danger">Supprimer agent</button></form></details></td></tr>${playerRows("agent",a.id)}`;
  }).join("");

  const promoterRows=promoters.map(p=>{const ps=children("promoter",p.id);return `<tr class="owner ${p.active?"":"off"}"><td><strong>${esc(p.name)}</strong><small>${esc(p.promoter_code)}</small></td><td>${esc(p.telegram_username?"@"+String(p.telegram_username).replace(/^@/,""):"—")}</td><td>${ps.length}</td><td>—</td><td>—</td><td>—</td><td>—</td><td><button type="button" onclick="togglePlayers('promoter-${p.id}', this)">▶ Joueurs (${ps.length})</button> <button type="button" onclick="copyLink('${esc(referralLink(p.promoter_code))}')">Copier lien</button><details><summary>Gérer</summary><form class="row" method="post" action="/admin/update-owner"><input type="hidden" name="type" value="promoter"><input type="hidden" name="id" value="${p.id}"><label>Nom<input name="name" value="${esc(p.name)}" required></label><label>Telegram<input name="telegram_username" value="${esc(p.telegram_username||"")}"></label><button>Modifier</button></form><form method="post" action="/admin/toggle-owner"><input type="hidden" name="type" value="promoter"><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="active" value="${p.active?0:1}"><button>${p.active?"Désactiver":"Réactiver"}</button></form><form method="post" action="/admin/delete-owner" onsubmit="return confirm('ATTENTION : supprimer ce promoteur supprimera aussi tous ses joueurs et leurs données poker. Continuer ?');"><input type="hidden" name="type" value="promoter"><input type="hidden" name="id" value="${p.id}"><button class="danger">Supprimer promoteur</button></form></details></td></tr>${playerRows("promoter",p.id)}`;}).join("");

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>88 Poker Manager</title>
<style>*{box-sizing:border-box}body{margin:0;background:#0b0b0d;color:#fff;font-family:Arial}header{padding:20px 28px;background:#111114;border-bottom:1px solid #29292d;display:flex;justify-content:space-between;align-items:center}.wrap{padding:24px;max-width:1600px;margin:auto}.panel{background:#151518;border:1px solid #29292d;border-radius:14px;padding:15px;margin-bottom:16px}.grid,.row{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.grid .panel{flex:1;min-width:280px}input,button{padding:9px;border:1px solid #35353b;border-radius:8px;background:#0f0f12;color:#fff}button{cursor:pointer;font-weight:700}label{font-size:12px;color:#aaa;display:flex;flex-direction:column;gap:5px}table{width:100%;border-collapse:collapse;min-width:1050px}th,td{padding:13px;border-bottom:1px solid #27272b;text-align:left;font-size:13px}th{color:#999;background:#101012}.scroll{overflow:auto;padding:0}.owner{background:#19191d}.player{background:#121215;color:#d0d0d5}.child-row{display:none}.off{opacity:.5}.danger{border-color:#6b2424;background:#351515}small{display:block;color:#92929b;margin-top:5px}.tabs a{display:inline-block;color:#aaa;text-decoration:none;padding:8px 12px}.tabs .active{color:#fff;border-bottom:2px solid #fff}.logout{color:#fff}.filters{display:flex;gap:10px;flex-wrap:wrap;align-items:end}summary{cursor:pointer;color:#aaa;margin:7px 0}.period-list{margin-top:12px;display:flex;flex-direction:column;gap:7px}.period-recap{background:#12351f;border:1px solid #287a43;border-radius:9px;padding:9px 10px;display:flex;align-items:center;justify-content:space-between;gap:10px}.period-info{display:flex;gap:12px;align-items:center;flex-wrap:wrap;color:#d9ffe4}.period-info strong{color:#7ff0a1}.edit-period{border-color:#3b9b59;background:#174929;white-space:nowrap}.no-period{color:#777;font-size:12px;padding:5px 0}.period-actions{display:flex;gap:7px;flex-wrap:wrap;align-items:center}.period-dropdown{margin-top:14px;border-top:1px solid #333;padding-top:8px}.period-dropdown>summary{color:#90e8a6;font-weight:700}.wheel-admin-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start}.wheel-admin-layout>.panel{min-width:0}.wheel-add-panel .tools{display:flex;flex-direction:column;align-items:stretch}.wheel-add-panel .tools label{width:100%}.wheel-add-panel .tools input{width:100%;min-width:0}.wheel-add-panel .tools button{width:100%}@media(max-width:1100px){.wheel-admin-layout{grid-template-columns:minmax(0,1fr) 270px}}@media(max-width:850px){.wheel-admin-layout{grid-template-columns:1fr}}@media(max-width:700px){.wrap{padding:12px}header{gap:12px;flex-direction:column;align-items:flex-start}}</style></head>
<body><header><div><h1 style="margin:0">88 Poker Manager</h1><small>Agents · Promoteurs · 🎡 Lucky Wheel</small></div><a class="logout" href="/admin/logout">Déconnexion</a></header><div class="wrap">
<div class="panel"><form class="filters" method="get" action="/dashboard"><input type="hidden" name="tab" value="${tab}"><label>Du<input type="date" name="from" value="${esc(from)}"></label><label>Au<input type="date" name="to" value="${esc(to)}"></label><button>Filtrer</button><a class="logout" href="/dashboard?tab=${tab}">Tout afficher</a></form></div>
<div class="grid"><div class="panel"><strong>+ Agent</strong><form class="row" method="post" action="/admin/create-agent"><label>Nom<input name="name" required></label><label>Telegram<input name="telegram_username" placeholder="@username"></label><button>Créer</button></form></div><div class="panel"><strong>+ Promoteur</strong><form class="row" method="post" action="/admin/create-promoter"><label>Nom<input name="name" required></label><label>Telegram<input name="telegram_username" placeholder="@username"></label><button>Créer</button></form></div></div>
<div class="panel tabs"><a class="${tab==="agents"?"active":""}" href="/dashboard?tab=agents">Agents</a><a class="${tab==="promoters"?"active":""}" href="/dashboard?tab=promoters">Promoteurs</a><a href="/dashboard?tab=wheel">🎡 Lucky Wheel</a></div>
<div class="panel scroll"><table><thead><tr><th>${tab==="agents"?"AGENT / JOUEUR":"PROMOTEUR / JOUEUR"}</th><th>ID / TELEGRAM</th><th>JOUEURS / USERNAME</th><th>MAINS</th><th>RAKE</th><th>% AGENT</th><th>COMMISSION</th><th>ACTIONS</th></tr></thead><tbody>${tab==="agents"?(agentRows||'<tr><td colspan="8">Aucun agent</td></tr>'):(promoterRows||'<tr><td colspan="8">Aucun promoteur</td></tr>')}</tbody></table></div></div>
<script>document.addEventListener("DOMContentLoaded",()=>{const id=${Number(openPlayer)||0};if(id){const f=document.getElementById("activity-"+id);if(f)setTimeout(()=>f.scrollIntoView({block:"center"}),50);}});function copyLink(v){navigator.clipboard.writeText(v).then(()=>alert("Lien copié : "+v)).catch(()=>prompt("Copiez le lien :",v));}function togglePlayers(key,btn){const rows=document.querySelectorAll(".child-"+key);const opening=[...rows].some(r=>getComputedStyle(r).display==="none");rows.forEach(r=>r.style.display=opening?"table-row":"none");btn.textContent=(opening?"▼":"▶")+btn.textContent.slice(1);}function editPeriod(playerId,start,end,hands,rake,pct){const f=document.getElementById("activity-"+playerId);if(!f)return;f.elements.period_start.value=start;f.elements.period_end.value=end;f.elements.hands_played.value=hands;f.elements.rake.value=Number(rake).toFixed(2);f.elements.agent_rake_percent.value=Number(pct).toFixed(2);f.elements.period_start.readOnly=true;f.elements.period_end.readOnly=true;f.scrollIntoView({behavior:"smooth",block:"center"});const b=f.querySelector("button");if(b)b.textContent="Mettre à jour la période";}</script></body></html>`;
}

// ==================== LUCKY WHEEL ====================
const WHEEL_PRIZES=[[10,70],[20,15],[30,8],[40,4],[50,2],[88,1]];
const WHEEL_PROMO_PRIZES=[[30,70],[40,20],[50,9],[88,1]];

async function wheelVerifyInitData(initData,botToken){
  if(!botToken||!initData)return null;
  const params=new URLSearchParams(initData),theirHash=params.get("hash");
  if(!theirHash)return null;
  params.delete("hash");
  const pairs=[...params.entries()].sort(([a],[b])=>a.localeCompare(b));
  const dataCheck=pairs.map(([k,v])=>`${k}=${v}`).join("\n");
  const enc=new TextEncoder();
  const webAppKey=await crypto.subtle.importKey("raw",enc.encode("WebAppData"),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const secretBytes=await crypto.subtle.sign("HMAC",webAppKey,enc.encode(botToken));
  const secretKey=await crypto.subtle.importKey("raw",secretBytes,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const hashBytes=new Uint8Array(await crypto.subtle.sign("HMAC",secretKey,enc.encode(dataCheck)));
  const ours=[...hashBytes].map(b=>b.toString(16).padStart(2,"0")).join("");
  if(!constantTimeEqual(ours,theirHash.toLowerCase()))return null;
  try{const user=JSON.parse(params.get("user")||"{}");return user?.id?user:null}catch{return null}
}
function constantTimeEqual(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
async function wheelCurrentUser(request,env){
  return wheelVerifyInitData(request.headers.get("X-Telegram-Init-Data")||"",env.WHEEL_TELEGRAM_BOT_TOKEN);
}
async function wheelEnsurePlayer(env,user){
  await env.DB.prepare(`
    INSERT INTO wheel_players(telegram_id,username,first_name,spins_available,updated_at)
    VALUES(?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name,updated_at=CURRENT_TIMESTAMP
  `).bind(String(user.id),user.username||null,user.first_name||null,0).run();
  return env.DB.prepare(`SELECT telegram_id,username,first_name,spins_available,promo_30,updated_at FROM wheel_players WHERE telegram_id=?`).bind(String(user.id)).first();
}
function wheelPickPrize(promo=false){
  const n=crypto.getRandomValues(new Uint32Array(1))[0]%100+1;let acc=0;
  for(const [prize,weight] of (promo?WHEEL_PROMO_PRIZES:WHEEL_PRIZES)){acc+=weight;if(n<=acc)return prize}return 10;
}
function wheelDashboard({players,spins,view}){
  const playerRows=players.map(x=>`<tr><td>${x.username?"@"+esc(x.username):esc(x.first_name||"—")}</td><td>${esc(x.telegram_id)}</td><td class="${Number(x.spins_available)?"on":""}">${Number(x.spins_available)||0} disponible(s)</td><td>${Number(x.total_spins||0)}</td><td>${Number(x.total_won||0)} $</td><td><form method="post" action="/admin/wheel/profile"><input type="hidden" name="telegram_id" value="${esc(x.telegram_id)}"><input type="hidden" name="promo_30" value="${Number(x.promo_30)?0:1}"><button type="submit" aria-label="Changer le profil promotionnel">${Number(x.promo_30)?"☑ Profil 30 $":"☐ Standard"}</button></form></td><td><form method="post" action="/admin/wheel/revoke" style="display:inline;margin:2px"><input type="hidden" name="telegram_id" value="${esc(x.telegram_id)}"><button>Tout retirer</button></form></td></tr>`).join("");
  const spinRows=spins.map(x=>`<tr><td>${x.username?"@"+esc(x.username):esc(x.first_name||"—")}</td><td>${esc(x.telegram_id)}</td><td><strong>${Number(x.prize)} $</strong></td><td>${esc(x.created_at)}</td><td>${esc(x.status)}</td><td>${x.status==="paid"?"✓ Payé":`<form method="post" action="/admin/wheel/paid"><input type="hidden" name="spin_id" value="${Number(x.id)}"><button>Marquer payé</button></form>`}</td></tr>`).join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>88 Poker Manager — Lucky Wheel</title>
<style>*{box-sizing:border-box}body{margin:0;background:#0b0b0d;color:#fff;font-family:Arial}header{padding:20px 28px;background:#111114;border-bottom:1px solid #29292d;display:flex;justify-content:space-between;align-items:center}.wrap{padding:24px;max-width:1600px;margin:auto}.panel{background:#151518;border:1px solid #29292d;border-radius:14px;padding:15px;margin-bottom:16px}.tabs a,.subtabs a{display:inline-block;color:#aaa;text-decoration:none;padding:8px 12px}.tabs .active,.subtabs .active{color:#fff;border-bottom:2px solid #fff}.scroll{overflow:auto;padding:0}table{width:100%;border-collapse:collapse;min-width:800px}th,td{padding:13px;border-bottom:1px solid #27272b;text-align:left;font-size:13px}th{color:#999;background:#101012}input,button{padding:9px;border:1px solid #35353b;border-radius:8px;background:#0f0f12;color:#fff}button{cursor:pointer;font-weight:700}.on{color:#ffe08a;font-weight:700}.logout{color:#fff}.tools{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.tools label{font-size:12px;color:#aaa;display:flex;flex-direction:column;gap:5px}.tools input{min-width:220px}.wheel-admin-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start}.wheel-admin-layout>.panel{min-width:0}.wheel-add-panel .tools{display:flex;flex-direction:column;align-items:stretch}.wheel-add-panel .tools label{width:100%}.wheel-add-panel .tools input{width:100%;min-width:0}.wheel-add-panel .tools button{width:100%}@media(max-width:1100px){.wheel-admin-layout{grid-template-columns:minmax(0,1fr) 270px}}@media(max-width:850px){.wheel-admin-layout{grid-template-columns:1fr}}@media(max-width:700px){.wrap{padding:12px}header{gap:12px;flex-direction:column;align-items:flex-start}}</style></head><body>
<header><div><h1 style="margin:0">88 Poker Manager</h1><small>Agents · Promoteurs · 🎡 Lucky Wheel</small></div><a class="logout" href="/admin/logout">Déconnexion</a></header><div class="wrap">
<div class="panel tabs"><a href="/dashboard?tab=agents">Agents</a><a href="/dashboard?tab=promoters">Promoteurs</a><a class="active" href="/dashboard?tab=wheel">🎡 Lucky Wheel</a></div>
<div class="panel subtabs"><a class="${view==="players"?"active":""}" href="/dashboard?tab=wheel">Joueurs / Tours</a><a class="${view==="history"?"active":""}" href="/dashboard?tab=wheel&view=history">Historique des gains</a> <a style="float:right" href="/wheel" target="_blank">Ouvrir la roulette ↗</a></div>
${view==="players"?`<div class="wheel-admin-layout"><div class="panel scroll"><table><thead><tr><th>JOUEUR</th><th>TELEGRAM ID</th><th>TOUR</th><th>TOURS JOUÉS</th><th>SOLDE À PAYER</th><th>PROFIL DE GAINS</th><th>ACTION</th></tr></thead><tbody>${playerRows||'<tr><td colspan="7">Aucun joueur Wheel</td></tr>'}</tbody></table></div><aside class="panel wheel-add-panel"><h2 style="margin:0 0 12px;color:#ffe08a;font-size:19px">➕ Ajouter des unités</h2><form class="tools" method="post" action="/admin/wheel/grant"><label>Telegram ID<input name="telegram_id" required inputmode="numeric"></label><label>Username (optionnel)<input name="username" placeholder="@username"></label><label>Prénom (optionnel)<input name="first_name"></label><label>Tours à ajouter<input name="quantity" type="number" min="1" max="1000" value="1" required></label><button type="submit" style="background:#166534;border:1px solid #4ade80;color:#fff;font-size:14px">+ Ajouter les unités</button></form><p style="color:#bcae8a;font-size:12px;line-height:1.5;margin:14px 0 0">Les profils de gains se règlent individuellement dans le tableau à gauche.</p></aside></div>`:`<div class="panel scroll"><table><thead><tr><th>JOUEUR</th><th>TELEGRAM ID</th><th>GAIN</th><th>DATE</th><th>STATUT</th><th>ACTION</th></tr></thead><tbody>${spinRows||'<tr><td colspan="6">Aucun tirage</td></tr>'}</tbody></table></div>`}
</div></body></html>`;
}

