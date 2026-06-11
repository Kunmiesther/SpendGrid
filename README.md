# SPENDGRID PROTOCOL

Autonomous AI Agent Payment Infrastructure for the QIE testnet (Chain ID `1983`).

## Structure

- `contracts/AgentRegistry.sol` registers agent owners, execution wallets, and QIE Pass identities.
- `contracts/SpendController.sol` enforces daily budgets, pause controls, and service whitelists.
- `contracts/StreamVault.sol` settles real QIE stablecoin transfers through `SafeERC20`.
- `contracts/MockQIEStable.sol` is the deployed testnet payment asset.
- `scripts/deploy.js` deploys the protocol to QIE testnet and writes `deployments/qie-testnet.json`.
- `backend/server.js` listens to contract events and exposes the REST API.

## Setup

```bash
npm install
cp .env.example .env
npm run compile
```

Set these values in `.env` before deploying:

```bash
QIE_RPC_URL=...
DEPLOYER_PRIVATE_KEY=...
```

Deploy:

```bash
npm run deploy:qie
```

Deployment always creates a fresh `MockQIEStable` and writes all contract addresses to
`deployments/qie-testnet.json`. The deploy script also updates `.env` with
`QIE_STABLECOIN_ADDRESS`, `AGENT_REGISTRY_ADDRESS`, `SPEND_CONTROLLER_ADDRESS`,
`STREAM_VAULT_ADDRESS`, and `DEPLOYMENT_PATH`. If `frontend/public` exists, the
same deployment artifact is copied to `frontend/public/deployments/qie-testnet.json`
so the frontend can load it from `/deployments/qie-testnet.json`.

Set `BACKEND_PRIVATE_KEY` before running the backend.

Run the backend:

```bash
npm run backend
```

## REST API

- `POST /create-agent`
- `POST /run-task`
- `POST /pause-agent`
- `GET /status/:agentId`

Payments are real ERC20 `transferFrom` settlements from the stream payer to the receiver. The payer must have QIE stablecoin balance and must approve `StreamVault` before `executePayment` can settle.
