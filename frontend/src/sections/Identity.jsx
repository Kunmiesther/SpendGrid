import React from "react";
import { motion } from "framer-motion";
import { useInView } from "../hooks/useInView";
import { useAgentSnapshot } from "../hooks/useAgentSnapshot";
import { shortenAddress } from "../lib/wallet";

function formatTimestamp(seconds) {
  const value = Number(seconds || 0);
  if (!value) return "Unavailable";
  return new Date(value * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export default function Identity() {
  const [ref, inView] = useInView(0.15);
  const { snapshot } = useAgentSnapshot();
  const streamVault = snapshot.contracts?.vault || snapshot.contracts?.streamVault;
  const qiePass = snapshot.qiePass || {};
  const agent = snapshot.agent || {};
  const checks = qiePass.checks || {};
  const attrs = [
    { label: "Agent ID", value: agent.id ? `AGT-${String(agent.id).padStart(3, "0")}` : "Unavailable" },
    { label: "Owner", value: agent.owner ? shortenAddress(agent.owner) : "Unavailable" },
    { label: "Agent wallet", value: agent.agentWallet ? shortenAddress(agent.agentWallet) : "Unavailable" },
    { label: "Issued", value: formatTimestamp(agent.createdAt) },
    { label: "Status", value: qiePass.status || "unknown", highlight: true },
    { label: "Vault allowed", value: checks.vaultWhitelisted ? "Yes" : "No", highlight: !checks.vaultWhitelisted },
  ];

  return (
    <section id="identity" ref={ref} className="bg-surface-1 border-t border-wire py-section">
      <div className="container-grid">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-start">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
          >
            <p className="tag mb-6">QIE Pass - Agent identity</p>
            <h2 className="text-display-md font-sans font-medium text-ink-0 text-balance mb-6">
              Every agent needs to prove who it is before it can spend.
            </h2>
            <p className="text-body-md text-ink-2 mb-10 max-w-md">
              QIE Pass state is read from the backend runtime and on-chain registry bindings for the active agent.
            </p>

            <div className="card-dark p-0 overflow-hidden max-w-sm">
              <div className="flex items-center justify-between px-6 py-4 border-b border-wire">
                <span className="font-mono text-label text-ink-3 uppercase tracking-widest">QIE Pass</span>
                <span className={`font-mono text-label uppercase tracking-widest ${qiePass.verified ? "text-green-400" : "text-amber-500"}`}>
                  {qiePass.verified ? "Verified" : qiePass.status || "Unknown"}
                </span>
              </div>

              <div className="divide-y divide-wire">
                {attrs.map((a) => (
                  <div key={a.label} className="flex items-center justify-between px-6 py-4 gap-4">
                    <span className="text-body-sm text-ink-3">{a.label}</span>
                    <span className={`font-mono text-mono-sm text-right break-all ${a.highlight ? "text-ink-0" : "text-ink-1"}`}>
                      {a.value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="px-6 py-4 border-t border-wire">
                <p className="font-mono text-label text-ink-4 break-all">
                  {qiePass.qiePassId || "QIE Pass ID unavailable"}
                </p>
                <p className="font-mono text-label text-ink-4 truncate mt-2">
                  Vault {streamVault ? shortenAddress(streamVault) : "unavailable"}
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="border border-wire rounded-sm overflow-hidden"
          >
            <img
              src="/images/lucid-origin_Abstract_3D_render_of_interlocking_geometric_rings_and_planes_identity_verificat-0.jpg"
              alt="Execution core and identity layer"
              className="w-full object-cover"
              style={{ aspectRatio: "4/3" }}
            />
            <div className="bg-surface-2 border-t border-wire px-6 py-4">
              <p className="font-mono text-mono-sm text-ink-2">
                execution_core <span className="text-ink-4">/ identity.runtime</span>
              </p>
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-px bg-wire border border-wire rounded-sm overflow-hidden"
        >
          {[
            {
              step: "Registry",
              body: checks.passBound ? "The QIE Pass ID resolves to the active agent in AgentRegistry." : "The backend has not confirmed the pass binding yet.",
            },
            {
              step: "Wallet",
              body: checks.walletBound ? "The execution wallet is bound to the same agent ID." : "Execution wallet binding is not confirmed.",
            },
            {
              step: "Spend gate",
              body: checks.vaultWhitelisted ? "StreamVault is whitelisted for this agent in SpendController." : "StreamVault is not whitelisted for this agent.",
            },
          ].map((item) => (
            <div key={item.step} className="bg-surface-1 p-8">
              <p className="font-mono text-label text-ink-3 uppercase tracking-widest mb-3">{item.step}</p>
              <p className="text-body-sm text-ink-2">{item.body}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
