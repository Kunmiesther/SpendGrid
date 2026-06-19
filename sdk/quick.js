import { createSpendGridAdapter } from "./adapter.js";

/**
 * Smallest integration entry point for QIE dApps.
 *
 * @example
 * const pay = initSpendGrid(window.ethereum);
 * await pay({ receiver, amount: "0.05" });
 */
export function initSpendGrid(provider, options = {}) {
  const resolvedProvider = provider || options.provider || (typeof globalThis !== "undefined" ? globalThis.ethereum : null);
  const adapter = createSpendGridAdapter(resolvedProvider, options);

  const pay = (input) => adapter.pay(input);
  pay.adapter = adapter;
  pay.getAgent = () => adapter.getAgent();
  pay.getVault = () => adapter.getVault();
  pay.getLimits = () => adapter.getLimits();

  return pay;
}
