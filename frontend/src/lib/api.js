const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:8080";

function withQuery(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, value);
    }
  });

  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

async function request(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Unknown error" }));
    throw new Error(err.error || err.message || res.statusText);
  }
  return res.json();
}

export const api = {
  createAgent: (payload) => request("POST", "/create-agent", payload),
  runTask: (payload) => request("POST", "/run-task", payload),
  pauseAgent: (agentId) => request("POST", "/pause-agent", { agentId }),
  getStatus: (agentId) => request("GET", `/status/${agentId}`),
  runAgent: (payload) => request("POST", "/agent/run", payload),
  getAgentStatus: (agentId) => request("GET", withQuery("/agent/status", { agentId })),
  getAgentHistory: (params) => request("GET", withQuery("/agent/history", params)),
  startAgentLoop: (payload) => request("POST", "/agent/start-loop", payload),
  stopAgentLoop: () => request("POST", "/agent/stop-loop"),
  getAgentLoopStatus: () => request("GET", "/agent/loop-status"),
};
