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

export default function App() {
  return (
    <div className="min-h-screen bg-surface-0">
      <Nav />
      <main>
        <Hero />
        <TrustedInfra />
        <HowItWorks />
        <LiveSpend />
        <Identity />
        <BudgetControl />
        <Developers />
      </main>
      <Footer />
    </div>
  );
}
