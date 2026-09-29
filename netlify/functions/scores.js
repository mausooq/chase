const { getStore } = require("@netlify/blobs");

function formatTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function cleanMessage(message) {
  return String(message || "").trim().slice(0, 280);
}

function nextId(scores) {
  return scores.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
}

function getScoresStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) {
    throw new Error("Missing NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN");
  }
  return getStore({
    name: "simmi-chase-scores",
    siteID,
    token,
    consistency: "strong",
  });
}

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  try {
    const store = getScoresStore();
    const scores = (await store.get("all", { type: "json" })) || [];

    if (event.httpMethod === "GET") {
      return { statusCode: 200, headers, body: JSON.stringify(scores) };
    }

    const body = JSON.parse(event.body || "{}");

    if (event.httpMethod === "POST") {
      const seconds = Number(body.seconds);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 36000) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "invalid score" }) };
      }
      const entry = {
        id: nextId(scores),
        seconds,
        time: formatTime(seconds),
        at: new Date().toISOString(),
        message: cleanMessage(body.message),
      };
      scores.unshift(entry);
      const trimmed = scores.slice(0, 200);
      await store.setJSON("all", trimmed);
      return { statusCode: 200, headers, body: JSON.stringify({ entry, rows: trimmed }) };
    }

    if (event.httpMethod === "PATCH") {
      const id = Number(body.id);
      if (!Number.isFinite(id) || id <= 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "invalid id" }) };
      }
      const idx = scores.findIndex((row) => Number(row.id) === id);
      if (idx < 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "not found" }) };
      }
      scores[idx] = { ...scores[idx], message: cleanMessage(body.message) };
      await store.setJSON("all", scores);
      return { statusCode: 200, headers, body: JSON.stringify({ entry: scores[idx], rows: scores }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "method not allowed" }) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Could not read or write scores" }),
    };
  }
};
