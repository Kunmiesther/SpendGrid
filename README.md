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

Payments are real ERC20 `transferFrom` settlements from the stream payer to the receiver. For backend-controlled streams, the runtime reads the current QUSDC allowance, submits a `StreamVault` approval when needed, waits for confirmation, re-reads allowance, and only then executes the payment. The default approval policy is `QUSDC_APPROVAL_POLICY=max`; set `QUSDC_APPROVAL_POLICY=configured` with `QUSDC_APPROVAL_AMOUNT_WEI`, or `QUSDC_APPROVAL_POLICY=exact`, to change that behavior.

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

## Mock QUSDC Dev Mode

For deterministic dev/testnet simulation without a faucet, mint function, or DEX
liquidity, run the protocol with `QUSDC_MODE=mock`. Mock mode bypasses QIEDex
entirely; the backend only checks the ERC20 balance of the configured mock token.

```bash
QUSDC_MODE=mock npm run deploy:qie
```

The deploy script creates `MockQUSDC`, wires the new `StreamVault` to that token,
and writes these values to `.env` and `deployments/qie-testnet.json`:

```bash
QUSDC_MODE=mock
QUSDC_ADDRESS=0x...
MOCK_QUSDC_ADDRESS=0x...
```

Bootstrap the dev agent and vault whitelist, then fund and approve the runtime
signer:

```bash
npx hardhat run scripts/bootstrapSpendGrid.js --network qieTestnet
npx hardhat run scripts/fundSignerMockQUSDC.js --network qieTestnet
```

Run the backend and submit a spend:

```bash
npm run backend
curl -X POST http://localhost:8080/run-task \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":1,\"prompt\":\"pay mock dev receiver\",\"receiver\":\"0xRECEIVER\",\"ratePerUnit\":\"1000000000000000000\",\"units\":\"1\"}"
```

`fundSignerMockQUSDC.js` mints mock QUSDC to `MOCK_QUSDC_RECIPIENT`,
`BACKEND_SIGNER_ADDRESS`, or the wallet derived from `BACKEND_PRIVATE_KEY`, then
approves `StreamVault` unless `MOCK_QUSDC_APPROVE_VAULT=false`.

You can deploy only the token with:

```bash
npx hardhat run scripts/deployMockQUSDC.js --network qieTestnet
```

For actual `StreamVault` transfers to succeed, the deployed `StreamVault` must
use the same mock token as its payment token. If the current vault was deployed
with a different token, redeploy the protocol with `QUSDC_MODE=mock`; the backend
will fail fast instead of silently using the wrong token.
