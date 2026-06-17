import React from "react";
import Nav from "./components/Nav";
import Hero from "./sections/Hero";
import TrustedInfra from "./sections/TrustedInfra";
import HowItWorks from "./sections/HowItWorks";
import LiveSpend from "./sections/LiveSpend";
import Identity from "./sections/Identity";
import BudgetControl from "./sections/BudgetControl";
import Developers from "./sections/Developers";
import Footer from "./sections/Footer";
import Dashboard from "./pages/Dashboard";
import { AgentSnapshotProvider } from "./hooks/useAgentSnapshot";

export default function App() {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const isDashboard = path === "/dashboard";

  return (
    <AgentSnapshotProvider interval={3000}>
      <div className="min-h-screen bg-surface-0">
        <Nav />
        {isDashboard ? (
          <Dashboard />
        ) : (
          <main>
            <Hero />
            <TrustedInfra />
            <HowItWorks />
            <LiveSpend />
            <Identity />
            <BudgetControl />
            <Developers />
          </main>
        )}
        {!isDashboard && <Footer />}
      </div>
    </AgentSnapshotProvider>
  );
}
