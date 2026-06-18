const API_BASE =
  process.env.REACT_APP_API_URL ||
  window.__SPENDGRID_API__ ||
  "https://spendgrid-2xhq.onrender.com";

export { API_BASE };

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
  const res = await fetch(`${API_BASE}${path}`, opts);
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    if (payload && path === "/payment-intents") {
      return payload;
    }
    throw new Error(payload?.error || payload?.message || res.statusText);
  }
  return payload;
}

export const api = {
  createAgent: (payload) => request("POST", "/create-agent", payload),
  runTask: (payload) => request("POST", "/run-task", payload),
  pauseAgent: (agentId) => request("POST", "/pause-agent", { agentId }),
  getStatus: (agentId) => request("GET", `/status/${agentId}`),
  runAgent: (payload) => request("POST", "/agent/run", payload),
  getAgentStatus: (agentId) => request("GET", withQuery("/agent/status", { agentId })),
  getAgentSnapshot: (agentId) => request("GET", withQuery("/agent/snapshot", { agentId })),
  getAgentEventsUrl: (agentId) => `${API_BASE}${withQuery("/agent/events", { agentId })}`,
  getAgentHistory: (params) => request("GET", withQuery("/agent/history", params)),
  submitPaymentIntent: (payload) => request("POST", "/payment-intents", payload),
  getPaymentIntents: (params) => request("GET", withQuery("/payment-intents", params)),
  startAgentLoop: (payload) => request("POST", "/agent/start-loop", payload),
  stopAgentLoop: () => request("POST", "/agent/stop-loop"),
  getAgentLoopStatus: () => request("GET", "/agent/loop-status"),
};
