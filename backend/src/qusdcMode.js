const MOCK_QUSDC_BYPASS_REASON = "QUSDC_MODE_MOCK_BYPASS";

function normalizeQusdcMode(value) {
  return String(value || "").trim().toLowerCase();
}

function getQusdcMode() {
  return normalizeQusdcMode(process.env.QUSDC_MODE);
}

function isMockQusdcMode() {
  return getQusdcMode() === "mock";
}

function getMockQusdcAddress(env = process.env) {
  return env.MOCK_QUSDC_ADDRESS || env.QUSDC_ADDRESS || "";
}

module.exports = {
  MOCK_QUSDC_BYPASS_REASON,
  getMockQusdcAddress,
  getQusdcMode,
  isMockQusdcMode,
  normalizeQusdcMode
};
