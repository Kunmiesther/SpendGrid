class AgentLoop {
  constructor(options = {}) {
    this.agentRuntime = options.agentRuntime;
    this.intervalMs = Number(options.intervalMs || process.env.AGENT_LOOP_INTERVAL_MS || 15000);
    this.taskQueue = [];
    this.running = false;
    this.inFlight = false;
    this.timer = null;
    this.lastDecision = null;
    this.lastTransactionHash = null;
    this.cumulativeSpending = 0n;
    this.lastError = null;
    this.totalCycles = 0;
    this.startedAt = null;
    this.stoppedAt = null;

    if (!this.agentRuntime) {
      throw new Error("AgentLoop requires agentRuntime");
    }
    if (this.intervalMs < 10000 || this.intervalMs > 20000) {
      this.intervalMs = 15000;
    }
  }

  start(seedTasks = []) {
    if (Array.isArray(seedTasks)) {
      seedTasks.forEach((task) => this.enqueue(task));
    }

    if (this.running) {
      return this.status();
    }

    this.running = true;
    this.startedAt = new Date().toISOString();
    this.stoppedAt = null;
    this.lastError = null;
    this._schedule(0);

    return this.status();
  }

  stop() {
    this.running = false;
    this.stoppedAt = new Date().toISOString();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    return this.status();
  }

  enqueue(task) {
    if (typeof task === "string" && task.trim()) {
      this.taskQueue.push({ task: task.trim() });
      return;
    }

    if (task && typeof task === "object") {
      const normalized = {
        ...task,
        task: typeof task.task === "string" ? task.task.trim() : ""
      };
      if (normalized.task) {
        this.taskQueue.push(normalized);
      }
    }
  }

  status() {
    return {
      running: this.running,
      inFlight: this.inFlight,
      intervalMs: this.intervalMs,
      queuedTasks: this.taskQueue.length,
      totalCycles: this.totalCycles,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      lastDecision: this.lastDecision,
      lastTransactionHash: this.lastTransactionHash,
      cumulativeSpending: this.cumulativeSpending.toString(),
      lastError: this.lastError
    };
  }

  async runOnce(task) {
    if (task) {
      this.enqueue(task);
    }

    return this._tick();
  }

  _schedule(delay = this.intervalMs) {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);

    this.timer = setTimeout(async () => {
      await this._tick().catch(() => {});
      this._schedule();
    }, delay);
  }

  async _tick() {
    if (this.inFlight) {
      return null;
    }

    this.inFlight = true;
    this.totalCycles += 1;

    try {
      const task = this.taskQueue.shift() || this._simulateTask();
      const result = await this.agentRuntime.run(task);

      this.lastDecision = result.decision || null;
      this.lastTransactionHash = result.transaction?.executePayment?.txHash || null;

      const amount = BigInt(result.transaction?.executePayment?.amountWei || "0");
      if (amount > 0n) {
        this.cumulativeSpending += amount;
      }

      this.lastError = null;
      return result;
    } catch (error) {
      this.lastError = {
        message: error.shortMessage || error.message,
        timestamp: new Date().toISOString()
      };
      return null;
    } finally {
      this.inFlight = false;
    }
  }

  _simulateTask() {
    return {
      task: [
        "Autonomously evaluate whether SpendGrid should pay for this cycle's AI execution.",
        "Spend only if the expected economic value exceeds the payment cost.",
        "Hold if budget risk, low confidence, or weak value signal is detected."
      ].join(" ")
    };
  }
}

module.exports = {
  AgentLoop
};
