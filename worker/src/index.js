/**
 * Exercise Coach Worker
 * Persistent storage for gym logs and weight entries.
 *
 * Routes:
 *   POST   /gym-log          Save a gym session
 *   GET    /gym-log          Get all gym sessions
 *   DELETE /gym-log?date=    Delete session for a date (and optional session_type)
 *   POST   /weight           Save a weight entry
 *   GET    /weight           Get all weight entries
 *   DELETE /weight?date=     Delete weight entry for a date
 *
 * Auth: Authorization: Bearer <secret>
 */

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

    return jsonResponse({ error: "Not found" }, 404, origin);
  },
};
