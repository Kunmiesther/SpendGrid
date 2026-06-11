const BASE_URL = process.env.REACT_APP_API_URL || "https://api.spendgrid.io/v1";

async function request(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Unknown error" }));
    throw new Error(err.message || res.statusText);
  }
  return res.json();
}

export const api = {
  createAgent: (payload) => request("POST", "/create-agent", payload),
  runTask: (payload) => request("POST", "/run-task", payload),
  pauseAgent: (agentId) => request("POST", "/pause-agent", { agentId }),
  getStatus: (agentId) => request("GET", `/status/${agentId}`),
};
