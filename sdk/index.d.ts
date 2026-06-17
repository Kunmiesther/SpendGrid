import type { BrowserProvider, JsonRpcProvider, Provider, Signer } from "ethers";

export type SpendGridNetworkName = "qieTestnet";
export type SpendGridPayMode = "instant" | "stream";
export type SpendGridStatus = "executed" | "rejected" | "failed" | "confirmed";

export interface SpendGridAddresses {
  agentRegistry: string;
  spendController: string;
  streamVault: string;
  qusdc: string;
}

export interface SpendGridDeployment {
  network?: string;
  chainId?: number | string;
  addresses?: Partial<SpendGridAddresses> & Record<string, string | undefined>;
  agentRegistry?: string;
  registry?: string;
  spendController?: string;
  controller?: string;
  streamVault?: string;
  vault?: string;
  qieStablecoin?: string;
  stable?: string;
  qusdc?: string;
}

export interface SpendGridNetworkConfig {
  name?: string;
  chainId?: number | string;
  addresses?: Partial<SpendGridAddresses>;
}

export interface SpendGridSDKOptions {
  agentId?: string | number | bigint;
  signer?: Signer | Provider | BrowserProvider | JsonRpcProvider | unknown;
  provider?: Provider | BrowserProvider | JsonRpcProvider | unknown;
  rpcUrl?: string;
  network?: SpendGridNetworkName | SpendGridNetworkConfig;
  deployment?: SpendGridDeployment;
  backendUrl?: string;
  apiUrl?: string;
  safeSpendLimit?: string | number | bigint;
  safeSpendLimitWei?: string | number | bigint;
  safeVault?: string;
  safeVaultAddress?: string;
  tokenDecimals?: number;
  cache?: SpendGridCache;
  cacheTtlMs?: number;
  adapterMode?: boolean;
}

export interface SpendGridPayInput {
  sdk?: SpendGridSDK;
  client?: SpendGridSDK;
  sdkOptions?: SpendGridSDKOptions;
  agentId?: string | number | bigint;
  intentId?: string;
  receiver?: string;
  recipient?: string;
  amount?: string | number | bigint;
  amountWei?: string | number | bigint;
  mode?: SpendGridPayMode;
  metadata?: Record<string, unknown>;
  streamId?: string | number | bigint;
  units?: string | number | bigint;
}

export interface SpendGridReceipt {
  intentId?: string;
  runId?: string;
  txHash: string | null;
  status: SpendGridStatus;
  accepted?: boolean;
  amount: string;
  streamId: string | null;
  timestamp: string;
  metadata?: Record<string, unknown> | null;
  validation?: Record<string, unknown>;
  decision?: Record<string, unknown>;
  transaction?: Record<string, unknown> | null;
}

export interface SpendGridPaymentIntent {
  intentId?: string;
  recipient: string;
  amount?: string | number | bigint;
  amountWei?: string | number | bigint;
  agentId?: string | number | bigint;
  streamId?: string | number | bigint | null;
  metadata?: Record<string, unknown> | null;
}

export interface SpendGridVaultOptions extends SpendGridSDKOptions {
  sdk?: SpendGridSDK;
  client?: SpendGridSDK;
  agentId?: string | number | bigint;
  receiver?: string;
  amount?: string | number | bigint;
  ratePerUnit?: string | number | bigint;
  ratePerUnitWei?: string | number | bigint;
  streamId?: string | number | bigint;
  units?: string | number | bigint;
}

export interface SpendGridPayButtonOptions extends SpendGridPayInput {
  element: string | EventTarget;
  beforePay?: (event: Event) => boolean | void | Promise<boolean | void>;
  onSuccess?: (receipt: SpendGridReceipt) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}

export interface SpendGridPayButtonBinding {
  sdk: SpendGridSDK;
  element: EventTarget;
  detach(): void;
}

export interface SpendGridSubscriptionOptions extends SpendGridSDKOptions {
  sdk?: SpendGridSDK;
  client?: SpendGridSDK;
  source?: "contract" | "backend";
  event?: string;
  agentId?: string | number | bigint;
  streamId?: string | number | bigint;
  intervalMs?: number;
  onEvent?: (event: unknown) => void;
  callback?: (event: unknown) => void;
  onError?: (error: Error) => void;
}

export interface KillSwitchOptions extends SpendGridSDKOptions {
  sdk?: SpendGridSDK;
  client?: SpendGridSDK;
  agentId?: string | number | bigint;
  safeVault?: string;
  safeVaultAddress?: string;
  receiver?: string;
  amountWei?: string | number | bigint;
  status?: Record<string, unknown>;
  rules?: Record<string, unknown>;
}

export interface SpendGridAdapterOptions extends SpendGridSDKOptions {
  sdk?: SpendGridSDK;
  autoCreateAgent?: boolean;
  autoConfigureAgent?: boolean;
  defaultDailyLimit?: string | number | bigint;
  defaultDailyLimitWei?: string | number | bigint;
  qiePassId?: string;
  metadata?: Record<string, unknown>;
}

export interface SpendGridAdapter {
  pay(input: SpendGridPayInput): Promise<SpendGridReceipt & Record<string, unknown>>;
  getAgent(): Promise<Record<string, unknown>>;
  getVault(): Promise<Record<string, unknown>>;
  getLimits(): Promise<Record<string, unknown>>;
}

export class SpendGridError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(message: string, code?: string, details?: Record<string, unknown>);
}

export class SpendGridCache {
  constructor(options?: { ttlMs?: number });
  get(namespace: string, key: unknown): unknown;
  set(namespace: string, key: unknown, value: unknown, options?: { ttlMs?: number }): unknown;
  has(namespace: string, key: unknown): boolean;
  delete(namespace: string, key: unknown): void;
  clear(namespace?: string): void;
  remember<T>(namespace: string, key: unknown, loader: () => Promise<T> | T, options?: { ttlMs?: number; force?: boolean }): Promise<T>;
}

export class SpendGridSDK {
  constructor(options?: SpendGridSDKOptions);
  agentId: bigint | null;
  backendUrl: string | null;
  safeVault: string | null;
  tokenDecimals: number;
  addresses: SpendGridAddresses;
  provider: Provider | BrowserProvider | JsonRpcProvider;
  signer: Signer | null;
  createVault(options?: SpendGridVaultOptions): Promise<Record<string, unknown>>;
  getVault(options?: SpendGridVaultOptions): Promise<Record<string, unknown>>;
  createStream(options?: SpendGridVaultOptions): Promise<Record<string, unknown>>;
  executePayment(options?: SpendGridVaultOptions): Promise<Record<string, unknown>>;
  pay(options?: SpendGridPayInput): Promise<SpendGridReceipt>;
  submitPaymentIntent(intent?: SpendGridPaymentIntent): Promise<Record<string, unknown>>;
  subscribe(options?: SpendGridSubscriptionOptions): () => void;
  emergencyPauseVault(options?: KillSwitchOptions): Promise<Record<string, unknown>>;
  routeRemainingFundsToSafeVault(options?: KillSwitchOptions): Promise<Record<string, unknown>>;
  detectAnomalyFlags(options?: KillSwitchOptions): Promise<Record<string, unknown>>;
  getAgent(agentId?: string | number | bigint): Promise<Record<string, unknown>>;
  getBudget(agentId?: string | number | bigint): Promise<Record<string, unknown>>;
  getSafeSpendLimit(agentId?: string | number | bigint): Promise<Record<string, unknown>>;
  loadBackendStatus(agentId?: string | number | bigint): Promise<Record<string, unknown> | null>;
}

export function createVault(options?: SpendGridVaultOptions): Promise<Record<string, unknown>>;
export function getVault(options?: SpendGridVaultOptions): Promise<Record<string, unknown>>;
export function createStream(options?: SpendGridVaultOptions): Promise<Record<string, unknown>>;
export function executePayment(options?: SpendGridVaultOptions): Promise<Record<string, unknown>>;
export function pay(options?: SpendGridPayInput): Promise<SpendGridReceipt>;
export function subscribe(options?: SpendGridSubscriptionOptions): () => void;
export function attachSpendGridPay(options: SpendGridPayButtonOptions): SpendGridPayButtonBinding;
export function createSpendGridCache(options?: { ttlMs?: number }): SpendGridCache;
export function createSpendGridAdapter(provider?: unknown, options?: SpendGridAdapterOptions): SpendGridAdapter;
export function initSpendGrid(provider?: unknown, options?: SpendGridAdapterOptions): ((input: SpendGridPayInput) => Promise<SpendGridReceipt & Record<string, unknown>>) & {
  adapter: SpendGridAdapter;
  getAgent(): Promise<Record<string, unknown>>;
  getVault(): Promise<Record<string, unknown>>;
  getLimits(): Promise<Record<string, unknown>>;
};
export function emergencyPauseVault(options?: KillSwitchOptions): Promise<Record<string, unknown>>;
export function routeRemainingFundsToSafeVault(options?: KillSwitchOptions): Promise<Record<string, unknown>>;
export function detectAnomalyFlags(options?: KillSwitchOptions): Promise<Record<string, unknown>>;
export function isSpendGridAnomaly(result: unknown): boolean;
