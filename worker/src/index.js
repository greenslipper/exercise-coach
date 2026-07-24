/**
 * Exercise Coach Worker
 * Persistent storage for gym logs, weight entries, and the training plan.
 *
 * Routes:
 *   POST   /gym-log          Save a gym session
 *   GET    /gym-log          Get all gym sessions
 *   DELETE /gym-log?date=    Delete session for a date (and optional session_type)
 *   POST   /weight           Save a weight entry
 *   GET    /weight           Get all weight entries
 *   DELETE /weight?date=     Delete weight entry for a date
 *   GET    /plan             Get the current training plan (KV plan:current, else bundled default)
 *   POST   /plan             Replace the current training plan (replace-on-write)
 *
 * Auth: Authorization: Bearer <secret>
 */

// Bundled at deploy time from docs/plan_data.json — used as the default
// response for GET /plan when KV key plan:current has not been seeded yet.
import DEFAULT_PLAN from "../../docs/plan_data.json";

const CORS_HEADERS = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
});

function jsonResponse(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS(origin),
    },
  });
}

function unauthorized(origin) {
  return jsonResponse({ error: "Unauthorized" }, 401, origin);
}

// One-way Telegram self-notification (same closed loop as the coach's notify_telegram.py: only ever
// to Freddie's own chat). Used by the dead-man's-switch below. No-op if creds aren't configured, so
// a half-set-up Worker never throws.
async function sendTelegram(env, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

function isAuthorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/, "");
  return token === env.AUTH_SECRET;
}

function getOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "https://freddiegreen.github.io";
  return origin === allowed ? origin : allowed;
}

// --- Gym log handlers ---

async function getGymLogs(env, origin) {
  const value = await env.COACH_DATA.get("gym_logs");
  const logs = value ? JSON.parse(value) : [];
  return jsonResponse(logs, 200, origin);
}

async function postGymLog(request, env, origin) {
  const body = await request.json();
  const { date, session_type, exercises, notes } = body;

  if (!date || !exercises) {
    return jsonResponse({ error: "date and exercises are required" }, 400, origin);
  }

  const value = await env.COACH_DATA.get("gym_logs");
  const logs = value ? JSON.parse(value) : [];

  // Replace if same date + session_type already exists
  const idx = logs.findIndex(
    (l) => l.date === date && l.session_type === (session_type || "strength")
  );
  const entry = {
    date,
    session_type: session_type || "strength",
    exercises,
    notes: notes || null,
    logged_at: new Date().toISOString(),
  };

  if (idx >= 0) {
    logs[idx] = entry;
  } else {
    logs.push(entry);
  }

  logs.sort((a, b) => b.date.localeCompare(a.date));

  await env.COACH_DATA.put("gym_logs", JSON.stringify(logs));
  return jsonResponse({ ok: true, entry }, 200, origin);
}

async function deleteGymLog(request, env, origin) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const session_type = url.searchParams.get("session_type");

  if (!date) {
    return jsonResponse({ error: "date query param is required" }, 400, origin);
  }

  const value = await env.COACH_DATA.get("gym_logs");
  const logs = value ? JSON.parse(value) : [];

  const before = logs.length;
  const filtered = logs.filter((l) => {
    if (l.date !== date) return true;
    if (session_type && l.session_type !== session_type) return true;
    return false;
  });

  if (filtered.length === before) {
    return jsonResponse({ ok: false, error: "No matching entry found" }, 404, origin);
  }

  await env.COACH_DATA.put("gym_logs", JSON.stringify(filtered));
  return jsonResponse({ ok: true, deleted: before - filtered.length }, 200, origin);
}

// --- Weight handlers ---

async function getWeightEntries(env, origin) {
  const value = await env.COACH_DATA.get("weight_entries");
  const entries = value ? JSON.parse(value) : [];
  return jsonResponse(entries, 200, origin);
}

async function postWeightEntry(request, env, origin) {
  const body = await request.json();
  const { date, weight_kg } = body;

  if (!date || weight_kg == null) {
    return jsonResponse({ error: "date and weight_kg are required" }, 400, origin);
  }

  const value = await env.COACH_DATA.get("weight_entries");
  const entries = value ? JSON.parse(value) : [];

  // Replace if same date already exists
  const idx = entries.findIndex((e) => e.date === date);
  const entry = {
    date,
    weight_kg: parseFloat(weight_kg),
    logged_at: new Date().toISOString(),
  };

  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }

  entries.sort((a, b) => b.date.localeCompare(a.date));

  await env.COACH_DATA.put("weight_entries", JSON.stringify(entries));
  return jsonResponse({ ok: true, entry }, 200, origin);
}

async function deleteWeightEntry(request, env, origin) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");

  if (!date) {
    return jsonResponse({ error: "date query param is required" }, 400, origin);
  }

  const value = await env.COACH_DATA.get("weight_entries");
  const entries = value ? JSON.parse(value) : [];

  const before = entries.length;
  const filtered = entries.filter((e) => e.date !== date);

  if (filtered.length === before) {
    return jsonResponse({ ok: false, error: "No matching entry found" }, 404, origin);
  }

  await env.COACH_DATA.put("weight_entries", JSON.stringify(filtered));
  return jsonResponse({ ok: true, deleted: before - filtered.length }, 200, origin);
}

// --- Plan handlers ---

async function getPlan(env, origin) {
  const value = await env.COACH_DATA.get("plan:current");
  const plan = value ? JSON.parse(value) : DEFAULT_PLAN;
  return jsonResponse(plan, 200, origin);
}

async function postPlan(request, env, origin) {
  const body = await request.json();

  if (!body || typeof body !== "object" || !Array.isArray(body.weeks)) {
    return jsonResponse({ error: "a plan object with a weeks array is required" }, 400, origin);
  }

  await env.COACH_DATA.put("plan:current", JSON.stringify(body));
  return jsonResponse({ ok: true }, 200, origin);
}

// --- Dead-man's-switch (external liveness observer) ---
//
// The Air's daily coach job POSTs /ping when it completes. This always-on Worker is the ONE observer
// that survives the Air being off/asleep/crashed (the on-box watchdog can't run then). Its cron
// (see wrangler.toml [triggers]) checks how long since the last ping and alerts Telegram if the
// engine has gone dark. KV keys: deadman:last_ping (epoch ms, Worker-stamped) and deadman:last_alert
// (epoch ms of the last alert sent — throttles re-alerts, cleared on recovery).

async function postPing(env, origin) {
  const now = Date.now();
  const wasAlerted = await env.COACH_DATA.get("deadman:last_alert");
  await env.COACH_DATA.put("deadman:last_ping", String(now));
  // If we'd alerted that the engine was down, this ping means it's back — confirm + clear alert state.
  if (wasAlerted) {
    await env.COACH_DATA.delete("deadman:last_alert");
    await sendTelegram(env, "✅ Coach engine recovered — a daily run just completed. (Dead-man's switch cleared.)");
  }
  return jsonResponse({ ok: true, at: now }, 200, origin);
}

async function deadmanCheck(env) {
  const maxAgeH = parseFloat(env.DEADMAN_MAX_AGE_H || "27");
  const realertH = parseFloat(env.DEADMAN_REALERT_H || "12");
  const now = Date.now();

  const lastPingRaw = await env.COACH_DATA.get("deadman:last_ping");
  // Never pinged yet → not armed. Stay silent (don't alarm before the first run ever records a ping).
  if (!lastPingRaw) return;
  const ageMs = now - parseInt(lastPingRaw, 10);
  if (ageMs < maxAgeH * 3600000) return; // engine is alive within the window

  // Stale — but throttle: only (re-)alert if we haven't in the last realertH hours.
  const lastAlertRaw = await env.COACH_DATA.get("deadman:last_alert");
  if (lastAlertRaw && now - parseInt(lastAlertRaw, 10) < realertH * 3600000) return;

  const ageH = Math.round(ageMs / 3600000);
  const lastStr = new Date(parseInt(lastPingRaw, 10)).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  await sendTelegram(
    env,
    `🔴 DEAD-MAN'S SWITCH — the coach engine has gone dark. No completed daily run in ${ageH}h ` +
      `(last: ${lastStr}). The Air may be OFF, asleep, wedged, or crashed — and no brief has gone ` +
      `out. Check it: .coachapp/automation.log on the Air, or re-run .coachapp/daily_coach.sh.`
  );
  await env.COACH_DATA.put("deadman:last_alert", String(now));
}

// --- Main handler ---

export default {
  async fetch(request, env) {
    const origin = getOrigin(request, env);
    const url = new URL(request.url);
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS(origin) });
    }

    // Auth check for all non-OPTIONS requests
    if (!isAuthorized(request, env)) {
      return unauthorized(origin);
    }

    if (url.pathname === "/gym-log") {
      if (method === "GET") return getGymLogs(env, origin);
      if (method === "POST") return postGymLog(request, env, origin);
      if (method === "DELETE") return deleteGymLog(request, env, origin);
    }

    if (url.pathname === "/weight") {
      if (method === "GET") return getWeightEntries(env, origin);
      if (method === "POST") return postWeightEntry(request, env, origin);
      if (method === "DELETE") return deleteWeightEntry(request, env, origin);
    }

    if (url.pathname === "/plan") {
      if (method === "GET") return getPlan(env, origin);
      if (method === "POST") return postPlan(request, env, origin);
    }

    // Liveness ping from the Air's daily job (authenticated above via the shared bearer).
    if (url.pathname === "/ping") {
      if (method === "POST") return postPing(env, origin);
    }

    return jsonResponse({ error: "Not found" }, 404, origin);
  },

  // Cron trigger (wrangler.toml [triggers]) — the dead-man's-switch. Runs on Cloudflare's schedule,
  // independent of the Air, so it fires even when the engine is powered off.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(deadmanCheck(env));
  },
};
