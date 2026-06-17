import React from "react";
import { motion } from "framer-motion";
import { useInView } from "../hooks/useInView";

const STEPS = [
  {
    index: "01",
    label: "Human operator",
    body: "You deploy an agent and define its spending policy — daily caps, allowed services, and identity credentials.",
  },
  {
    index: "02",
    label: "External app",
    body: "Your app submits a payment intent with recipient, amount, agent ID, and task metadata.",
  },
  {
    index: "03",
    label: "Agent policy engine",
    body: "SpendGrid invokes the agent policy only for that intent, then checks QIE Pass, budget, controller rules, and liquidity.",
  },
  {
    index: "04",
    label: "Payment engine",
    body: "If validation passes, the existing vault execution flow opens or uses a stream and settles the payment.",
  },
  {
    index: "05",
    label: "QIE blockchain",
    body: "The transaction settles on-chain. Events are emitted for monitoring, audit, and downstream automation.",
  },
  {
    index: "06",
    label: "Service provider",
    body: "The provider receives payment in real time and delivers the result back to the agent.",
  },
];

export default function HowItWorks() {
  const [ref, inView] = useInView(0.1);

  return (
    <section id="how-it-works" ref={ref} className="bg-surface-1 border-t border-wire py-section">
      <div className="container-grid">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          <p className="tag mb-6">How it works</p>
          <h2 className="text-display-md font-sans font-medium text-ink-0 max-w-lg text-balance">
            From payment intent to settlement in one validated flow.
          </h2>
        </motion.div>

        {/* Step cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-wire border border-wire rounded-sm overflow-hidden">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.index}
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : {}}
              transition={{ duration: 0.45, delay: i * 0.07 }}
              className="bg-surface-1 p-8 group hover:bg-surface-2 transition-colors duration-200"
            >
              <div className="flex items-start gap-5">
                <span className="font-mono text-label text-ink-4 pt-1 select-none">{step.index}</span>
                <div>
                  <p className="font-sans font-medium text-ink-0 text-body-md mb-2">{step.label}</p>
                  <p className="text-body-sm text-ink-2">{step.body}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Flow diagram image */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.4 }}
          className="mt-16 border border-wire rounded-sm overflow-hidden"
        >
          <img
            src="/images/lucid-origin_Top-down_architectural_blueprint_diagram_of_a_data_pipeline_clean_vector-style_l-0.jpg"
            alt="End-to-end payment flow diagram"
            className="w-full object-cover"
            style={{ aspectRatio: "1200/480" }}
          />
        </motion.div>
      </div>
    </section>
  );
}
