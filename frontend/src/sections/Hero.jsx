import React from "react";
import { motion } from "framer-motion";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] },
  }),
};

export default function Hero() {
  return (
    <section className="relative pt-32 pb-0 bg-surface-0">
      <div className="container-grid">
        {/* Top tag */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={0}
          className="mb-10"
        >
          <span className="tag">v1.0 — Now on QIE Mainnet</span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={1}
          className="text-display-xl font-sans font-medium text-ink-0 text-balance max-w-[900px] mb-7"
        >
          Autonomous payment infrastructure
          <br className="hidden lg:block" /> for AI agents.
        </motion.h1>

        {/* Description */}
        <motion.p
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={2}
          className="text-body-lg text-ink-2 max-w-[540px] mb-10"
        >
          SpendGrid gives your agents programmable budgets, on-chain identity, and real-time spending
          control — without a human in the loop for every transaction.
        </motion.p>

        {/* CTAs */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={3}
          className="flex flex-wrap items-center gap-4 mb-20"
        >
          <a href="#how-it-works" className="btn-primary">
            Get started
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <a href="#developers" className="btn-secondary">
            View documentation
          </a>
        </motion.div>

        {/* Hero image block */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="w-full border border-wire rounded-t-sm overflow-hidden"
        >
          <img
            src="/images/lucid-origin_Dark_studio_render_of_a_glowing_neural_network_node_geometric_icosahedron_shape_-0.jpg"
            alt="AI agent execution environment"
            className="w-full h-auto object-cover"
            style={{ aspectRatio: "1200/640" }}
          />
        </motion.div>
      </div>
    </section>
  );
}
