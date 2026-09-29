(() => {
  const KEY = "simmi-chase-scores";
  const ENDPOINTS = ["/api/scores", "/.netlify/functions/scores"];

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function readLocal() {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  function writeLocal(list) {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200)));
  }

  function cleanMessage(message) {
    return String(message || "").trim().slice(0, 280);
  }

  function makeEntry(seconds, message, extra) {
    return {
      id: extra && extra.id,
      seconds: Number(seconds),
      time: formatTime(seconds),
      at: (extra && extra.at) || new Date().toISOString(),
      message: cleanMessage(message),
    };
  }

  function upsertLocal(entry) {
    const local = readLocal();
    const idx = entry.id != null ? local.findIndex((row) => row.id === entry.id) : -1;
    if (idx >= 0) local[idx] = { ...local[idx], ...entry };
    else local.unshift(entry);
    writeLocal(local);
    return local;
  }

  async function request(method, body) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) continue;
        return await res.json();
      } catch (_) {
        /* local file server or missing function */
      }
    }
    return null;
  }

  function rowsFrom(remote, fallback) {
    if (Array.isArray(remote)) return remote;
    if (remote && Array.isArray(remote.rows)) return remote.rows;
    return fallback;
  }

  window.ChaseScores = {
    formatTime,
    readLocal,
    async save(seconds, message) {
      const entry = makeEntry(seconds, message);
      const local = upsertLocal(entry);
      const remote = await request("POST", { seconds: entry.seconds, message: entry.message });
      const saved = remote && remote.entry ? remote.entry : entry;
      if (saved.id != null) upsertLocal(saved);
      return { entry: saved, rows: rowsFrom(remote, local), remote: Boolean(remote && remote.entry) };
    },
    async update(id, message) {
      const note = cleanMessage(message);
      const local = readLocal();
      const idx = local.findIndex((row) => row.id === id);
      if (idx >= 0) {
        local[idx].message = note;
        writeLocal(local);
      }
      const remote = await request("PATCH", { id, message: note });
      const saved = remote && remote.entry ? remote.entry : local[idx];
      if (saved) upsertLocal(saved);
      return { entry: saved, rows: rowsFrom(remote, local), remote: Boolean(remote && remote.entry) };
    },
    async all() {
      const remote = await request("GET");
      if (Array.isArray(remote)) return { rows: remote, remote: true };
      if (remote && Array.isArray(remote.rows)) return { rows: remote.rows, remote: true };
      return { rows: readLocal(), remote: false };
    },
  };
})();
