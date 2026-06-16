# SpendGrid SDK

Framework-agnostic SDK for integrating SpendGrid payments into external dApps.

```js
import { SpendGridSDK, attachSpendGridPay } from "@spendgrid/sdk";

const sdk = new SpendGridSDK({ agentId: 1, signer: window.ethereum });

await sdk.pay({
  receiver: "0x0000000000000000000000000000000000000001",
  amount: "1",
  mode: "instant"
});

const binding = attachSpendGridPay({
  element: "#pay",
  sdk,
  receiver: "0x0000000000000000000000000000000000000001",
  amount: "1",
  onSuccess: (receipt) => console.log(receipt),
  onError: (error) => console.error(error)
});
```

The SDK performs client-side registry and SpendController preflight before
sending a transaction. Contract rules remain authoritative.
