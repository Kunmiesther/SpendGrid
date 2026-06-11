const fs = require("fs");
const path = require("path");
const { PROJECT_ROOT } = require("./deployment");
const { bigintJson, nowIso, startOfUtcDay } = require("./utils");

const DEFAULT_LOG_PATH = path.join(PROJECT_ROOT, "backend", "logs", "agent-engine.ndjson");

class AgentLedger {
  constructor(options = {}) {
    this.logPath = options.logPath || process.env.AGENT_LOG_PATH || DEFAULT_LOG_PATH;
    this.maxMemoryRecords = Number(options.maxMemoryRecords || process.env.AGENT_LOG_MEMORY_LIMIT || 1000);
    this.records = [];

    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    this._loadExistingRecords();
  }

  append(entry) {
    const record = bigintJson({
      timestamp: nowIso(),
      ...entry
    });

    this.records.push(record);
    if (this.records.length > this.maxMemoryRecords) {
      this.records = this.records.slice(this.records.length - this.maxMemoryRecords);
    }

    fs.appendFileSync(this.logPath, `${JSON.stringify(record)}\n`);
    console.log(JSON.stringify(record));

    return record;
  }

  list(filters = {}) {
    const limit = Math.min(Number(filters.limit || 100), 500);
    const agentId = filters.agentId === undefined ? null : String(filters.agentId);
    const eventType = filters.eventType || null;

    return this.records
      .filter((record) => {
        if (agentId && String(record.agentId) !== agentId) return false;
        if (eventType && record.eventType !== eventType) return false;
        return true;
      })
      .slice(-limit)
      .reverse();
  }

  dailyPaymentSpend(agentId, date = new Date()) {
    const dayStart = startOfUtcDay(date).getTime();
    const targetAgentId = String(agentId);

    return this.records.reduce((total, record) => {
      if (record.eventType !== "contract_interaction") return total;
      if (record.status !== "confirmed") return total;
      if (record.interactionType !== "executePayment") return total;
      if (String(record.agentId) !== targetAgentId) return total;
      if (new Date(record.timestamp).getTime() < dayStart) return total;

      return total + BigInt(record.amount || "0");
    }, 0n);
  }

  _loadExistingRecords() {
    if (!fs.existsSync(this.logPath)) {
      return;
    }

    const lines = fs.readFileSync(this.logPath, "utf8").split(/\r?\n/).filter(Boolean);
    this.records = lines
      .slice(-this.maxMemoryRecords)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_error) {
          return null;
        }
      })
      .filter(Boolean);
  }
}

module.exports = {
  AgentLedger,
  DEFAULT_LOG_PATH
};
