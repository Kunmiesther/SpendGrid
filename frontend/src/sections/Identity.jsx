import React from "react";
import { motion } from "framer-motion";
import { useInView } from "../hooks/useInView";
import { useDeployment } from "../hooks/useDeployment";
import { shortenAddress } from "../lib/wallet";

const ATTRS = [
  { label: "Pass type", value: "Operator — Tier 2" },
  { label: "Registry ID", value: "SGR-0047" },
  { label: "Issued", value: "2025-03-11" },
  { label: "Expiry", value: "2026-03-11" },
  { label: "Status", value: "Verified", highlight: true },
  { label: "Services allowed", value: "14 of 14" },
];

export default function Identity() {
  const [ref, inView] = useInView(0.15);
  const deployment = useDeployment();
  const streamVault = deployment?.addresses?.streamVault;

  return (
    <section id="identity" ref={ref} className="bg-surface-1 border-t border-wire py-section">
      <div className="container-grid">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-start">
          {/* Left: copy + pass card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
          >
            <p className="tag mb-6">QIE Pass — Agent identity</p>
            <h2 className="text-display-md font-sans font-medium text-ink-0 text-balance mb-6">
              Every agent needs to prove who it is before it can spend.
            </h2>
            <p className="text-body-md text-ink-2 mb-10 max-w-md">
              QIE Pass is a verifiable on-chain credential issued to each registered agent. Service
              providers check the pass before accepting any payment stream — no integrations
              required on their end.
            </p>

            {/* Pass card */}
            <div className="card-dark p-0 overflow-hidden max-w-sm">
              {/* Card header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-wire">
                <span className="font-mono text-label text-ink-3 uppercase tracking-widest">QIE Pass</span>
                <span className="font-mono text-label text-green-400 uppercase tracking-widest">Active</span>
              </div>

              {/* Attrs */}
              <div className="divide-y divide-wire">
                {ATTRS.map((a) => (
                  <div key={a.label} className="flex items-center justify-between px-6 py-4">
                    <span className="text-body-sm text-ink-3">{a.label}</span>
                    <span className={`font-mono text-mono-sm ${a.highlight ? "text-ink-0" : "text-ink-1"}`}>
                      {a.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Card footer */}
              <div className="px-6 py-4 border-t border-wire">
                <p className="font-mono text-label text-ink-4 truncate">
                  {streamVault ? shortenAddress(streamVault) : "0x4f2a8c3d19e0b5f2a714d3e8...e91b2c91e"}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Right: standalone image block */}
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="border border-wire rounded-sm overflow-hidden"
          >
            <img
              src="frontend/public/images/lucid-origin_Abstract_3D_render_of_interlocking_geometric_rings_and_planes_identity_verificat-0.jpg"
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

        {/* How pass works */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-px bg-wire border border-wire rounded-sm overflow-hidden"
        >
          {[
            {
              step: "Issue",
              body: "When you register an agent, SpendGrid mints a QIE Pass bound to its wallet address and your operator account.",
            },
            {
              step: "Attach",
              body: "The pass is included in every payment stream header. Providers verify it on-chain in under 200ms.",
            },
            {
              step: "Revoke",
              body: "A single API call or UI action revokes the pass instantly. All active streams are closed within one block.",
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
