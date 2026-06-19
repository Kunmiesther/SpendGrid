# SpendGrid SDK

Framework-agnostic SDK for integrating SpendGrid payments into external dApps.

```js
import { SpendGridSDK, attachSpendGridPay } from "@spendgrid/sdk";

const sdk = new SpendGridSDK({
  agentId: 1,
  signer: window.ethereum,
  backendUrl: "https://your-spendgrid-backend.example"
});

await sdk.pay({
  receiver: "0x0000000000000000000000000000000000000001",
  amount: "0.05",
  mode: "instant",
  metadata: { task: "settle model inference", source: "my-app" }
});

const binding = attachSpendGridPay({
  element: "#pay",
  sdk,
  receiver: "0x0000000000000000000000000000000000000001",
  amount: "0.05",
  onSuccess: (receipt) => console.log(receipt),
  onError: (error) => console.error(error)
});
```

`pay()` submits a payment intent to the configured SpendGrid backend. The backend
validates agent status, QIE Pass, budget, controller whitelist, and liquidity,
then manages QUSDC allowance for backend-controlled execution before calling the
vault. The SDK does not bypass backend validation.
