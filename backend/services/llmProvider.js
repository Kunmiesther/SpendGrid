class LLMProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
    this.baseUrl = options.baseUrl || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
    this.model = options.model || process.env.OPENROUTER_MODEL || "openrouter/auto";
    this.appUrl = options.appUrl || process.env.OPENROUTER_APP_URL || "https://spendgrid.local";
    this.appName = options.appName || process.env.OPENROUTER_APP_NAME || "SpendGrid";
  }

  async runTask(task) {
    if (!this.apiKey) {
      const error = new Error("OPENROUTER_API_KEY is required");
      error.statusCode = 500;
      throw error;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": this.appUrl,
        "X-Title": this.appName
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "You are the SpendGrid Agent Runtime. Execute the user's task as an autonomous backend agent and return a concise, actionable response."
          },
          {
            role: "user",
            content: task
          }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(`OpenRouter request failed with ${response.status}: ${body}`);
      error.statusCode = response.status;
      throw error;
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message?.content || "";

    return {
      response: message,
      model: data.model || this.model,
      usage: data.usage || this.estimateUsage(task, message),
      providerResponseId: data.id || null
    };
  }

  estimateUsage(prompt, completion) {
    return {
      estimated: true,
      prompt_tokens: Math.ceil(String(prompt || "").length / 4),
      completion_tokens: Math.ceil(String(completion || "").length / 4),
      total_tokens: Math.ceil(`${prompt || ""}${completion || ""}`.length / 4)
    };
  }
}

module.exports = {
  LLMProvider
};
