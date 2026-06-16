import { SpendGridSDK } from "./client.js";
import { SpendGridError, resolveElement } from "./utils.js";

/**
 * Attach a SpendGrid payment action to any clickable DOM element.
 *
 * @param {object} options
 * @param {string|EventTarget} options.element CSS selector or element.
 * @param {SpendGridSDK} [options.sdk] Existing SDK instance.
 * @param {object} [options.sdkOptions] SDK constructor options when sdk is not supplied.
 * @param {number|string|bigint} [options.agentId]
 * @param {string} [options.receiver]
 * @param {string|number|bigint} [options.amount]
 * @param {"instant"|"stream"} [options.mode]
 * @param {object} [options.metadata]
 * @param {(receipt: object) => void|Promise<void>} [options.onSuccess]
 * @param {(error: Error) => void|Promise<void>} [options.onError]
 * @returns {{detach: Function, sdk: SpendGridSDK, element: EventTarget}}
 */
export function attachSpendGridPay(options = {}) {
  const element = resolveElement(options.element);
  const sdk = options.sdk || new SpendGridSDK({
    ...(options.sdkOptions || {}),
    agentId: options.agentId ?? options.sdkOptions?.agentId
  });

  let inFlight = false;
  const onClick = async (event) => {
    if (typeof options.beforePay === "function") {
      const shouldContinue = await options.beforePay(event);
      if (shouldContinue === false) {
        return;
      }
    }

    if (inFlight) {
      return;
    }

    inFlight = true;
    try {
      const receipt = await sdk.pay({
        agentId: options.agentId,
        receiver: options.receiver,
        amount: options.amount,
        amountWei: options.amountWei,
        mode: options.mode,
        streamId: options.streamId,
        units: options.units,
        metadata: options.metadata
      });
      await options.onSuccess?.(receipt);
    } catch (error) {
      const normalized = error instanceof Error
        ? error
        : new SpendGridError(String(error), "PAY_BUTTON_ERROR");
      if (typeof options.onError === "function") {
        await options.onError(normalized);
      } else {
        throw normalized;
      }
    } finally {
      inFlight = false;
    }
  };

  element.addEventListener("click", onClick);

  return {
    sdk,
    element,
    detach() {
      element.removeEventListener("click", onClick);
    }
  };
}
