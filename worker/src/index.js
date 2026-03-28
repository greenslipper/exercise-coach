/**
 * Exercise Coach Worker
 * Persistent storage for gym logs and weight entries.
 *
 * Routes:
 *   POST /gym-log          Save a gym session
 *   GET  /gym-log          Get all gym sessions
 *   POST /weight           Save a weight entry
 *   GET  /weight           Get all weight entries
 *
 * Auth: Authorization: Bearer <secret>
 */

const CORS_HEADERS = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

  // Keep sorted by date desc
  logs.sort((a, b) => b.date.localeCompare(a.date));

  await env.COACH_DATA.put("gym_logs", JSON.stringify(logs));
  return jsonResponse({ ok: true, entry }, 200, origin);
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
    }

    if (url.pathname === "/weight") {
      if (method === "GET") return getWeightEntries(env, origin);
      if (method === "POST") return postWeightEntry(request, env, origin);
    }

    return jsonResponse({ error: "Not found" }, 404, origin);
  },
};
