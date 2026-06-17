import React, { useState } from "react";
import { motion } from "framer-motion";
import { useInView } from "../hooks/useInView";
import { useDeployment } from "../hooks/useDeployment";
import { shortenAddress } from "../lib/wallet";

const ENDPOINTS = [
  {
    method: "POST",
    path: "/create-agent",
    desc: "Register a new agent with an initial spending policy and identity credentials.",
    body: `{
  "name": "inference-worker-03",
  "dailyBudget": 20000,
  "allowedServices": ["openai", "storage"],
  "passRequired": true
}`,
  },
  {
    method: "POST",
    path: "/run-task",
    desc: "Dispatch a task to a registered agent and open a payment stream.",
    body: `{
  "agentId": "AGT-001",
  "taskType": "llm_inference",
  "maxSpend": 500,
  "payload": { "prompt": "..." }
}`,
  },
  {
    method: "POST",
    path: "/pause-agent",
    desc: "Suspend all active payment streams for an agent without revoking its pass.",
    body: `{
  "agentId": "AGT-001",
  "reason": "Manual pause — budget review"
}`,
  },
  {
    method: "GET",
    path: "/status/:agentId",
    desc: "Retrieve current spend, stream count, pass status, and task history.",
    body: null,
  },
];

const METHOD_COLORS = {
  GET: "text-blue-400",
  POST: "text-green-400",
  DELETE: "text-red-400",
  PATCH: "text-amber-400",
};

const INTEGRATIONS = [
  {
    label: "REST API",
    body: "Stateless HTTP endpoints for agent lifecycle management. Authenticated with API keys or JWT.",
  },
  {
    label: "TypeScript SDK",
    body: "Typed client for Node.js and browser environments. Handles auth, retries, and event subscriptions.",
  },
  {
    label: "Smart contracts",
    body: "Interact directly with the BudgetEngine and PaymentEngine contracts. ABIs and address registry included.",
  },
  {
    label: "Event listeners",
    body: "Subscribe to on-chain events via WebSocket or polling. Filter by agent, event type, or amount range.",
  },
];

export default function Developers() {
  const [ref, inView] = useInView(0.1);
  const [activeEndpoint, setActiveEndpoint] = useState(0);
  const deployment = useDeployment();
  const integrations = INTEGRATIONS.map((item) => {
    if (item.label !== "Smart contracts" || !deployment?.addresses) {
      return item;
    }

    return {
      ...item,
      body: `Vault ${shortenAddress(deployment.addresses.streamVault)}. Registry ${shortenAddress(
        deployment.addresses.agentRegistry
      )}. Controller ${shortenAddress(deployment.addresses.spendController)}.`,
    };
  });

  return (
    <section id="developers" ref={ref} className="bg-surface-1 border-t border-wire py-section">
      <div className="container-grid">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          <p className="tag mb-6">Developer integration</p>
          <h2 className="text-display-md font-sans font-medium text-ink-0 max-w-xl text-balance">
            Ship agent payments without building payment infrastructure.
          </h2>
          <p className="text-body-md text-ink-2 max-w-md mt-4">
            Four integration paths. Pick the one that matches your stack.
          </p>
        </motion.div>

        {/* Integration options — 2-column grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-wire border border-wire rounded-sm overflow-hidden mb-16">
          {integrations.map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : {}}
              transition={{ duration: 0.4, delay: i * 0.07 }}
              className="bg-surface-1 p-8 hover:bg-surface-2 transition-colors duration-200"
            >
              <p className="font-sans font-medium text-ink-0 text-body-md mb-2">{item.label}</p>
              <p className="text-body-sm text-ink-2">{item.body}</p>
            </motion.div>
          ))}
        </div>

        {/* API endpoint explorer */}
        <motion.div
          id="api-reference"
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="border border-wire rounded-sm overflow-hidden"
        >
          <div className="flex items-center justify-between px-6 py-4 bg-surface-2 border-b border-wire">
            <span className="font-mono text-label text-ink-2 uppercase tracking-widest">API reference</span>
            <span className="font-mono text-label text-ink-4">v1</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[240px_1fr]">
            {/* Endpoint list */}
            <div className="border-b md:border-b-0 md:border-r border-wire bg-surface-2">
              {ENDPOINTS.map((ep, i) => (
                <button
                  key={ep.path}
                  onClick={() => setActiveEndpoint(i)}
                  className={`w-full text-left px-5 py-4 border-b border-wire last:border-b-0 transition-colors duration-150 ${
                    activeEndpoint === i ? "bg-surface-3" : "hover:bg-surface-3"
                  }`}
                >
                  <span className={`font-mono text-mono-sm font-medium mr-2 ${METHOD_COLORS[ep.method]}`}>
                    {ep.method}
                  </span>
                  <span className="font-mono text-mono-sm text-ink-1">{ep.path}</span>
                </button>
              ))}
            </div>

            {/* Detail pane */}
            <div className="bg-surface-1 p-7">
              <p className="text-body-sm text-ink-2 mb-6">
                {ENDPOINTS[activeEndpoint].desc}
              </p>

              <div className="flex items-center gap-3 mb-3">
                <span className={`font-mono text-mono-sm font-medium ${METHOD_COLORS[ENDPOINTS[activeEndpoint].method]}`}>
                  {ENDPOINTS[activeEndpoint].method}
                </span>
                <span className="font-mono text-mono-sm text-ink-1">
                  https://api.spendgrid.io/v1{ENDPOINTS[activeEndpoint].path}
                </span>
              </div>

              {ENDPOINTS[activeEndpoint].body && (
                <pre className="bg-surface-2 border border-wire rounded-sm p-5 overflow-x-auto">
                  <code className="font-mono text-mono-sm text-ink-1 whitespace-pre">
                    {ENDPOINTS[activeEndpoint].body}
                  </code>
                </pre>
              )}

              {!ENDPOINTS[activeEndpoint].body && (
                <div className="bg-surface-2 border border-wire rounded-sm px-5 py-4">
                  <span className="font-mono text-mono-sm text-ink-3">No request body required</span>
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <a href="#" className="btn-secondary text-xs">Full docs</a>
                <a href="#" className="btn-ghost text-xs">SDK reference</a>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Large infra image */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.35 }}
          className="mt-16 border border-wire rounded-sm overflow-hidden"
        >
          <img
            src="/images/lucid-origin_Wide_aerial_render_of_a_modular_server_rack_infrastructure_clean_rows_of_dark_ha-0.jpg"
            alt="SpendGrid execution core architecture"
            className="w-full object-cover"
            style={{ aspectRatio: "1200/440" }}
          />
          <div className="bg-surface-2 border-t border-wire px-8 py-5 flex items-center justify-between">
            <p className="font-mono text-mono-sm text-ink-3">
              spendgrid / execution_core — payment_engine.runtime
            </p>
            <a href="#" className="btn-ghost text-xs">Read architecture docs</a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
