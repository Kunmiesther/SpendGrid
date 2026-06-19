import React from "react";

const LINKS = [
  {
    category: "Product",
    items: [
      { label: "Dashboard", href: "#dashboard" },
      { label: "API Reference", href: "#api-reference" },
      { label: "How It Works", href: "#how-it-works" },
      { label: "Developer Integration", href: "#developers" },
    ],
  },
  {
    category: "Resources",
    items: [
      { label: "GitHub", href: "https://github.com/Kunmiesther/SpendGrid", external: true },
      { label: "QIE", href: "https://x.com/qieblockchain", external: true },
      { label: "SpendGrid", href: "https://x.com/SpendGridLabs", external: true },
    ],
  },
  {
    category: "Ecosystem",
    items: [
      { label: "QIE Explorer", href: "https://mainnet.qie.digital/", external: true },
      { label: "QIE Pass", href: "https://qiepass.qie.digital/", external: true },
      { label: "QIE Blockchain", href: "https://www.qie.digital/", external: true },
    ],
  },
];

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
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-8">
            {LINKS.map(({ category, items }) => (
              <div key={category}>
                <p className="stat-label mb-4">{category}</p>
                <ul className="space-y-3">
                  {items.map((item) => (
                    <li key={item.label}>
                      <a
                        href={item.href}
                        target={item.external ? "_blank" : undefined}
                        rel={item.external ? "noopener noreferrer" : undefined}
                        className="text-body-sm text-ink-3 hover:text-ink-1 transition-colors duration-150"
                      >
                        {item.label}
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
