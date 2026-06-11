const crypto = require("crypto");
const { LLMProvider } = require("./llmProvider");

class AgentRuntime {
  constructor(options = {}) {
    this.llmProvider = options.llmProvider || new LLMProvider(options.llm);
    this.history = [];
    this.status = "idle";
    this.currentRun = null;
  }

  async run(task) {
    const normalizedTask = this.validateTask(task);
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    this.status = "running";
    this.currentRun = {
      runId,
      task: normalizedTask,
      startedAt
    };

    try {
      const llmResult = await this.llmProvider.runTask(normalizedTask);
      const completedAt = new Date().toISOString();
      const record = {
        runId,
        task: normalizedTask,
        response: llmResult.response,
        model: llmResult.model,
        usage: llmResult.usage || null,
        providerResponseId: llmResult.providerResponseId || null,
        startedAt,
        completedAt,
        timestamp: completedAt,
        status: "completed"
      };

      this.history.unshift(record);
      this.status = "idle";
      this.currentRun = null;

      return record;
    } catch (error) {
      const failedAt = new Date().toISOString();
      const record = {
        runId,
        task: normalizedTask,
        response: null,
        model: null,
        usage: null,
        providerResponseId: null,
        startedAt,
        completedAt: failedAt,
        timestamp: failedAt,
        status: "failed",
        error: error.message
      };

      this.history.unshift(record);
      this.status = "idle";
      this.currentRun = null;

      throw error;
    }
  }

  getHistory(limit = 50) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return this.history.slice(0, safeLimit);
  }

  getStatus() {
    return {
      status: this.status,
      totalRuns: this.history.length,
      lastRun: this.history[0] || null
    };
  }

  validateTask(task) {
    if (typeof task !== "string" || task.trim().length === 0) {
      const error = new Error("task must be a non-empty string");
      error.statusCode = 400;
      throw error;
    }

    return task.trim();
  }
}

module.exports = {
  AgentRuntime
};
