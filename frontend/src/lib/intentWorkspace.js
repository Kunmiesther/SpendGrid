const TEMPLATE_STORAGE_KEY = "spendgrid.intent.templates.v2";
const POLICY_STORAGE_KEY = "spendgrid.intent.policy.v2";

function readJson(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

function writeJson(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_error) {
    // Local persistence is best-effort only.
  }
}

export function loadIntentTemplates() {
  const templates = readJson(TEMPLATE_STORAGE_KEY, []);
  return Array.isArray(templates) ? templates : [];
}

export function saveIntentTemplates(templates) {
  writeJson(TEMPLATE_STORAGE_KEY, Array.isArray(templates) ? templates : []);
}

export function loadIntentPolicy() {
  const policy = readJson(POLICY_STORAGE_KEY, null);
  return policy && typeof policy === "object" ? policy : {
    manualApprovalEnabled: false,
    manualApprovalThreshold: "",
    maxPaymentAmount: "",
    maxPaymentsPerDay: "",
    whitelistRecipients: ""
  };
}

export function saveIntentPolicy(policy) {
  writeJson(POLICY_STORAGE_KEY, policy || {});
}

export function normalizeWhitelistInput(value) {
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatWhitelistInput(list) {
  return Array.isArray(list) ? list.join("\n") : "";
}
