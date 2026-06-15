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
`BACKEND_PRIVATE_KEY` is the autonomous execution wallet used for on-chain
agent actions. The backend refuses to start without `DEFAULT_DAILY_LIMIT`.

Run the backend:

```bash
npm run backend
```

## REST API

- `POST /agent/run`
- `GET /agent/status`
- `GET /agent/history`
- `POST /create-agent`
- `POST /run-task`
- `POST /pause-agent`
- `GET /status/:agentId`

Payments are real ERC20 `transferFrom` settlements from the stream payer to the receiver. The payer must have QIE stablecoin balance and must approve `StreamVault` before `executePayment` can settle.

## Autonomous Agent Engine

`POST /agent/run` accepts `agentId`, `prompt`, and either an existing `streamId`
or a `receiver` plus `ratePerUnit`. The engine runs a policy-model step, chooses
`createStream`, `executePayment`, or `stopStream`, checks local and on-chain
daily limits, then sends the StreamVault transaction with `BACKEND_PRIVATE_KEY`.

Every decision and transaction is logged in memory and appended to
`backend/logs/agent-engine.ndjson` with structured fields for decision,
transaction hash, gas used, and contract interaction type.

## QIEDex Liquidity Requirement

The backend can attempt a WQIE -> QUSDC swap only when `QIEDEX_ROUTER_ADDRESS`,
`QIEDEX_FACTORY_ADDRESS`, `WQIE_ADDRESS`, and `QUSDC_ADDRESS` all resolve to
deployed contracts on QIE Testnet and the factory has a funded WQIE/QUSDC pair.

If the router, factory, token, pair, or pair reserves are missing, the runtime
skips the swap and logs a specific QIEDex diagnostic. Autonomous spending still
requires QUSDC, so fund the backend signer with QUSDC directly via faucet/mint,
or deploy/create and fund the WQIE-QUSDC pool before relying on swap-based
funding.
