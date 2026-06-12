import React from "react";

const LINKS = {
  Product: ["Dashboard", "API reference", "SDK", "Smart contracts", "Changelog"],
  Company: ["About", "Blog", "Security", "Privacy policy", "Terms of service"],
  Developers: ["Documentation", "GitHub", "npm package", "Status page", "Community"],
  Resources: ["Agent quickstart", "Budget policies", "QIE Pass guide", "Architecture overview", "Support"],
};

export default function Footer() {
  return (
    <footer className="bg-surface-0 border-t border-wire">
      <div className="container-grid py-20">
        {/* Top row */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-16 mb-20">
          {/* Brand */}
          <div>
            <p className="font-mono text-body-sm font-medium text-ink-0 mb-4">
              SPEND<span className="text-[#FF2D78]">GRID</span>
            </p>
            <p className="text-body-sm text-ink-3 max-w-xs">
              Autonomous Treasury infrastructure for AI agents. Programmable budgets, verifiable
              identity, real-time control.
            </p>
            <div className="flex gap-4 mt-8">
              <a href="#" className="btn-secondary text-xs px-4 py-2">Get started</a>
              <a href="#" className="btn-ghost text-xs">Read docs</a>
            </div>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
            {Object.entries(LINKS).map(([category, items]) => (
              <div key={category}>
                <p className="stat-label mb-4">{category}</p>
                <ul className="space-y-3">
                  {items.map((item) => (
                    <li key={item}>
                      <a href="#" className="text-body-sm text-ink-3 hover:text-ink-1 transition-colors duration-150">
                        {item}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="divider mb-8" />

        {/* Bottom row */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="text-body-sm text-ink-4">
            &copy; {new Date().getFullYear()} SpendGrid, Inc. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-body-sm text-ink-4 hover:text-ink-2 transition-colors">Privacy</a>
            <a href="#" className="text-body-sm text-ink-4 hover:text-ink-2 transition-colors">Terms</a>
            <a href="#" className="text-body-sm text-ink-4 hover:text-ink-2 transition-colors">Security</a>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full FF2D78" />
              <span className="text-body-sm text-ink-4">All systems operational</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
