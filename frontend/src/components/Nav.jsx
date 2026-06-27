import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWallet } from "../hooks/useWallet";

const NAV_LINKS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Live spend", href: "#live-spend" },
  { label: "Identity", href: "#identity" },
  { label: "Developers", href: "#developers" },
];

export default function Nav() {
  const {
    connected,
    shortAddress,
    connect,
    copy,
    copied,
    discoverProviders,
    disconnect,
    error,
    isQieMainnet,
    loading,
    openFaucet,
    providers,
    switchNetwork,
  } = useWallet();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-300 ${
        scrolled ? "bg-surface-0 border-b border-wire" : "bg-transparent"
      }`}
    >
      <div className="container-grid flex items-center justify-between h-14">
        {/* Logo */}
        <a href="/" className="flex items-center group">
  SPEND<span className="text-[#FF2D78]">GRID</span>
</a>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="font-sans text-body-sm text-ink-2 hover:text-ink-1 transition-colors duration-150"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Wallet + Menu */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => {
                discoverProviders();
                setWalletOpen((open) => (connected ? !open : true));
              }}
              disabled={loading}
              className="btn-secondary text-xs px-4 py-2"
            >
              {loading ? (
                <span className="font-mono text-xs text-ink-3">Connecting...</span>
              ) : connected ? (
                <span className="font-mono text-xs text-ink-0">{shortAddress}</span>
              ) : (
                "Connect Wallet"
              )}
            </button>

            <AnimatePresence>
              {walletOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="absolute right-0 mt-2 w-[min(18rem,calc(100vw-1.5rem))] max-h-[calc(100vh-5rem)] overflow-y-auto overflow-x-hidden bg-surface-1 border border-wire rounded-sm"
                >
                  {!connected &&
                    providers.map((wallet) => (
                      <button
                        key={wallet.id}
                        onClick={() => connect(wallet.id).then(() => setWalletOpen(false)).catch(() => {})}
                        disabled={loading}
                        className="w-full text-left px-4 py-3 border-b border-wire last:border-b-0 text-body-sm text-ink-1 hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="block">{wallet.label}</span>
                        {wallet.subtitle && (
                          <span className="block font-mono text-label uppercase tracking-widest text-ink-3 mt-1">
                            {wallet.subtitle}
                          </span>
                        )}
                      </button>
                    ))}

                  {!connected && providers.length === 0 && (
                    <div className="px-4 py-3 text-body-sm text-ink-3">No wallet found</div>
                  )}

                  {error && (
                    <div className="px-4 py-3 border-b border-wire text-body-sm text-red-400">
                      {error}
                    </div>
                  )}

                  {connected && !isQieMainnet && (
                    <button
                      onClick={() => switchNetwork().catch(() => {})}
                      className="w-full text-left px-4 py-3 border-b border-wire text-body-sm text-ink-1 hover:bg-surface-2 transition-colors"
                    >
                      Switch Network
                    </button>
                  )}

                  {connected && (
                    <>
                      <button
                        onClick={() => copy().catch(() => {})}
                        className="w-full text-left px-4 py-3 border-b border-wire text-body-sm text-ink-1 hover:bg-surface-2 transition-colors"
                      >
                        {copied ? "Copied" : "Copy address"}
                      </button>
                      <button
                        onClick={openFaucet}
                        className="w-full text-left px-4 py-3 border-b border-wire text-body-sm text-ink-1 hover:bg-surface-2 transition-colors"
                      >
                        QIE Explorer
                      </button>
                      <button
                        onClick={() => {
                          disconnect().catch(() => {});
                          setWalletOpen(false);
                        }}
                        className="w-full text-left px-4 py-3 text-body-sm text-ink-1 hover:bg-surface-2 transition-colors"
                      >
                        Disconnect
                      </button>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Hamburger */}
          <button
            className="md:hidden p-2 text-ink-2 hover:text-ink-1"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
              <rect width="18" height="1.5" fill="currentColor" />
              <rect y="5.25" width="12" height="1.5" fill="currentColor" />
              <rect y="10.5" width="18" height="1.5" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="md:hidden bg-surface-1 border-b border-wire px-6 py-5 flex flex-col gap-4"
          >
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="text-body-sm text-ink-1 hover:text-ink-0 transition-colors"
              >
                {l.label}
              </a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
