import React, { useState } from "react";
import { motion } from "framer-motion";
import { useInView } from "../hooks/useInView";
import { useAgentRuntime } from "../hooks/useAgentRuntime";

const SERVICES = [
  { id: "openai", label: "OpenAI Inference", enabled: true },
  { id: "storage", label: "Walrus Storage", enabled: true },
  { id: "oracle", label: "Pyth Oracle", enabled: false },
  { id: "bridge", label: "Cross-chain Bridge", enabled: false },
  { id: "vector", label: "Pinecone Vector DB", enabled: true },
];

function Toggle({ enabled, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={onChange}
      className={`relative w-9 h-5 rounded-sm transition-colors duration-200 focus:outline-none flex-shrink-0 ${
        enabled ? "bg-ink-1" : "bg-surface-5"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-sm bg-ink-0 transition-transform duration-200 ${
          enabled ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function BudgetControl() {
  const [ref, inView] = useInView(0.1);
  const { runAgent } = useAgentRuntime();
  const [services, setServices] = useState(SERVICES);
  const [paused, setPaused] = useState(false);
  const [dailyLimit, setDailyLimit] = useState(136000);
  const [perAgent, setPerAgent] = useState(20000);

  const toggleService = (id) =>
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));

  return (
    <section className="bg-surface-0 border-t border-wire py-section">
      <div className="container-grid">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          ref={ref}
          className="mb-16"
        >
          <p className="tag mb-6">Budget control</p>
          <h2 className="text-display-md font-sans font-medium text-ink-0 max-w-xl text-balance">
            Spending policy enforced at the protocol level.
          </h2>
          <p className="text-body-md text-ink-2 max-w-md mt-4">
            Every constraint you set here is encoded on-chain. There is no server-side check that
            can be bypassed.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">
          {/* Main control panel */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="card-dark overflow-hidden"
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-wire">
              <div className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-sm ${paused ? "bg-amber-500" : "bg-green-500"}`}
                />
                <span className="font-mono text-label uppercase tracking-widest text-ink-2">
                  Agent SGR-0047 — {paused ? "Paused" : "Running"}
                </span>
              </div>
              <button
                onClick={() => setPaused((p) => !p)}
                className="btn-secondary text-xs px-4 py-2"
              >
                {paused ? "Resume" : "Pause"}
              </button>
            </div>

            {/* Limits */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-wire">
              <div className="bg-surface-2 px-8 py-7">
                <label className="stat-label block mb-3">Daily limit (QIE)</label>
                <input
                  type="number"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(Number(e.target.value))}
                  className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-md px-4 py-2 rounded-sm focus:outline-none focus:border-ink-3 transition-colors"
                />
              </div>
              <div className="bg-surface-2 px-8 py-7">
                <label className="stat-label block mb-3">Per-agent cap (QIE)</label>
                <input
                  type="number"
                  value={perAgent}
                  onChange={(e) => setPerAgent(Number(e.target.value))}
                  className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-md px-4 py-2 rounded-sm focus:outline-none focus:border-ink-3 transition-colors"
                />
              </div>
            </div>

            {/* Policy row */}
            <div className="px-8 py-6 border-t border-wire">
              <p className="stat-label mb-4">Spending policy</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  "Require QIE Pass on all streams",
                  "Block streams over per-agent cap",
                  "Emit events on every payment",
                  "Auto-pause on policy violation",
                ].map((rule) => (
                  <div key={rule} className="flex items-start gap-3">
                    <svg width="14" height="14" viewBox="0 0 14 14" className="text-ink-2 mt-0.5 flex-shrink-0" fill="none">
                      <rect width="14" height="14" rx="1" fill="currentColor" fillOpacity={0.08} />
                      <path d="M3.5 7L6 9.5L10.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="text-body-sm text-ink-2">{rule}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Apply */}
            <div className="px-8 py-5 border-t border-wire flex gap-3">
              <button className="btn-primary" onClick={() => runAgent().catch(() => {})}>Apply policy</button>
              <button className="btn-ghost">Reset to defaults</button>
            </div>
          </motion.div>

          {/* Right column */}
          <div className="flex flex-col gap-6">
            {/* Service whitelist */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.55, delay: 0.15 }}
              className="card-dark overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-wire">
                <p className="stat-label">Allowed services</p>
              </div>
              <div className="divide-y divide-wire">
                {services.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-6 py-4">
                    <span className="text-body-sm text-ink-1">{s.label}</span>
                    <Toggle enabled={s.enabled} onChange={() => toggleService(s.id)} />
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Kill switch */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.55, delay: 0.22 }}
              className="card-dark border-red-900/40 overflow-hidden"
            >
              <div className="px-6 py-5 border-b border-red-900/40">
                <p className="font-mono text-label text-red-400 uppercase tracking-widest mb-1">Emergency stop</p>
                <p className="text-body-sm text-ink-3">
                  Closes all active streams and halts all agents immediately. This action takes effect within one block.
                </p>
              </div>
              <div className="px-6 py-5">
                <button className="w-full border border-red-800/50 bg-red-950/20 text-red-400 font-medium text-body-sm px-5 py-3 rounded-sm transition-transform duration-150 hover:scale-95 hover:bg-red-950/30">
                  Kill all agents
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
