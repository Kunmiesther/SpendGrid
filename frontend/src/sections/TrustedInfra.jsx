import React from "react";
import { motion } from "framer-motion";
import { useInView } from "../hooks/useInView";
import { useAgentSnapshot } from "../hooks/useAgentSnapshot";

const PILLARS = [
  {
    label: "Programmable budgets",
    body:
      "Define per-agent daily limits, per-service caps, and hard kill thresholds directly on-chain. Policies execute without backend calls.",
  },
  {
    label: "On-chain identity",
    body:
      "Every agent carries a QIE Pass - a verifiable credential that service providers can check before accepting a payment stream.",
  },
  {
    label: "Real-time control",
    body:
      "Pause, resume, or terminate any agent mid-stream. Budget state settles in under one block. No waiting for batch reconciliation.",
  },
  {
    label: "Audit-ready events",
    body:
      "Every spend, stream creation, and policy change is logged on-chain. Export structured event history directly into your compliance stack.",
  },
];

export default function TrustedInfra() {
  const [ref, inView] = useInView(0.15);
  const { snapshot } = useAgentSnapshot();
  const uptimeSeconds = snapshot.metrics?.uptimeSeconds || 0;
  const uptimeMinutes = Math.floor(uptimeSeconds / 60);
  const stats = [
    { val: snapshot.network?.blockNumber ? snapshot.network.blockNumber.toLocaleString() : "Pending", note: "Latest QIE block" },
    { val: `${uptimeMinutes}m`, note: "Backend uptime" },
    { val: String(snapshot.metrics?.paymentsProcessed || 0), note: "Payments processed" },
    { val: `${Number(snapshot.metrics?.totalSpent || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} QUSDC`, note: "Total settled" },
  ];

  return (
    <section ref={ref} className="bg-surface-0 border-t border-wire py-section">
      <div className="container-grid">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-16 lg:gap-24">
          {/* Left */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="tag mb-6">Infrastructure</p>
            <h2 className="text-display-md font-sans font-medium text-ink-0 text-balance mb-6">
              Payments agents can execute on their own.
            </h2>
            <p className="text-body-md text-ink-2 max-w-sm">
              Most payment rails assume a human authorizes every transaction. SpendGrid is built for
              the opposite assumption - agents that act autonomously within the bounds you set.
            </p>
          </motion.div>

          {/* Right: pillar grid (2-column max) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-wire">
            {PILLARS.map((p, i) => (
              <motion.div
                key={p.label}
                initial={{ opacity: 0, y: 16 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                className="bg-surface-0 p-8"
              >
                <p className="font-sans font-medium text-ink-0 text-body-md mb-3">{p.label}</p>
                <p className="text-body-sm text-ink-2">{p.body}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Stats bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-px bg-wire border border-wire rounded-sm overflow-hidden"
        >
          {stats.map((s) => (
            <div key={s.note} className="bg-surface-1 px-8 py-7">
              <p className="font-mono text-display-md font-medium text-ink-0 mb-1 break-words">{s.val}</p>
              <p className="text-label text-ink-3 uppercase tracking-widest">{s.note}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
