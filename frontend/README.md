# SpendGrid

**Autonomous Treasury Infrastructure for AI Agents**

SpendGrid gives your agents programmable budgets, on-chain identity via QIE Pass, and real-time spending control — without a human in the loop for every transaction.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | React 18 |
| Styling | TailwindCSS v3 |
| Animation | Framer Motion |
| Wallet | ethers.js v6 |
| Fonts | IBM Plex Sans + IBM Plex Mono |

---

## Project structure

```
spendgrid/
├── public/
│   └── index.html
├── src/
│   ├── App.jsx                    # Root — assembles all sections
│   ├── index.js                   # React entry point
│   ├── index.css                  # Tailwind directives + global styles
│   │
│   ├── components/
│   │   └── Nav.jsx                # Sticky nav with wallet connect + mobile menu
│   │
│   ├── sections/
│   │   ├── Hero.jsx               # Headline, CTAs, large image block
│   │   ├── TrustedInfra.jsx       # Four-pillar grid + stats bar
│   │   ├── HowItWorks.jsx         # Six-step flow + diagram image
│   │   ├── LiveSpend.jsx          # Real-time spend stats + agent table
│   │   ├── Identity.jsx           # QIE Pass card + image block + how-it-works
│   │   ├── BudgetControl.jsx      # Budget panel + service whitelist + kill switch
│   │   ├── Developers.jsx         # Integration cards + live API explorer
│   │   └── Footer.jsx             # Link columns + status indicator
│   │
│   ├── hooks/
│   │   ├── useInView.js           # Scroll-triggered IntersectionObserver
│   │   ├── useLiveSpend.js        # Polling hook — swap setInterval for WebSocket
│   │   └── useWallet.js           # ethers.js wallet connection state
│   │
│   └── lib/
│       ├── api.js                 # REST client — POST /create-agent etc.
│       └── wallet.js              # connectWallet, shortenAddress, getBalance
│
├── tailwind.config.js
├── postcss.config.js
└── package.json
```

---

## Getting started

```bash
# Install dependencies
npm install

# Start dev server
npm start

# Production build
npm run build
```

---

## Environment variables

Create a `.env` file in the project root:

```env
REACT_APP_API_URL=https://api.spendgrid.io/v1
```

---

## Backend endpoints expected

| Method | Path | Description |
|---|---|---|
| `POST` | `/create-agent` | Register agent with spending policy |
| `POST` | `/run-task` | Dispatch task and open payment stream |
| `POST` | `/pause-agent` | Suspend agent without revoking QIE Pass |
| `GET` | `/status/:agentId` | Fetch spend, streams, pass status |

---

## Real-time data

`useLiveSpend.js` currently uses `setInterval` polling with mock data.

To connect to a real event stream, replace the interval with a WebSocket subscription:

```js
// src/hooks/useLiveSpend.js — replace setInterval with:
const ws = new WebSocket('wss://events.spendgrid.io/stream');
ws.onmessage = (event) => {
  const { type, agentId, amount } = JSON.parse(event.data);
  // update agents state based on event type
};
```

Events emitted by the contract:

- `AgentRegistered(agentId, operator, budget)`
- `StreamCreated(agentId, serviceId, amount)`
- `PaymentExecuted(agentId, serviceId, amount, timestamp)`
- `AgentPaused(agentId, reason)`

---

## Wallet integration

`useWallet.js` wraps `ethers.BrowserProvider`. It works with MetaMask and any EIP-1193 compatible provider. To add WalletConnect support, swap `window.ethereum` for a WalletConnect provider in `src/lib/wallet.js`.

---

## Design system

All design tokens live in `tailwind.config.js`:

- **Palette:** `surface-0` through `surface-5` (dark neutrals) + `ink-0` through `ink-4` (text)
- **Border:** `wire` (`#1f1f1f`) — single consistent border color throughout
- **Typography:** IBM Plex Sans for UI, IBM Plex Mono for data and code
- **Buttons:** `.btn-primary`, `.btn-secondary`, `.btn-ghost` — all scale down on hover via `hover:scale-95`
- **Animations:** scroll-triggered `useInView` + Framer Motion — no idle loops

---

## Replacing placeholder images

All images use `placehold.co` URLs. Replace them in each section file:

| Section | File | Replace with |
|---|---|---|
| Hero | `sections/Hero.jsx` | Dashboard screenshot or agent viz |
| How it works | `sections/HowItWorks.jsx` | Flow diagram |
| Live spend | `sections/LiveSpend.jsx` | Budget engine screenshot |
| Identity | `sections/Identity.jsx` | Identity/credential visual |
| Developers | `sections/Developers.jsx` | Architecture diagram |
