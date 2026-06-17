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

  async decideEconomicAction(input) {
    const content = JSON.stringify(input);
    const systemPrompt = [
      "You are the SpendGrid autonomous AI economic agent.",
      "You fully control spending decisions under Option B architecture.",
      "Decide whether the task deserves an on-chain spend or whether funds should be held.",
      "Return STRICT JSON ONLY. Do not wrap in markdown. Do not include prose outside JSON.",
      'Schema: {"action":"spend"|"hold","amount":number,"reasoning":"string"}',
      "The amount is denominated in QIE token units, not wei/base units. Decimal amounts below 1 are valid.",
      "Never choose an amount greater than budgetRemaining or safeSpendLimit.",
      "Choose hold with amount 0 when value is unclear, budget is insufficient, or history suggests risk."
    ].join(" ");

    const data = await this.createChatCompletion({
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content
        }
      ],
      responseFormat: { type: "json_object" }
    });

    return {
      content: data.choices?.[0]?.message?.content || "",
      model: data.model || this.model,
      usage: data.usage || this.estimateUsage(content, data.choices?.[0]?.message?.content || ""),
      providerResponseId: data.id || null
    };
  }

  async createChatCompletion({ messages, responseFormat }) {
    if (!this.apiKey) {
      const error = new Error("OPENROUTER_API_KEY is required");
      error.statusCode = 500;
      throw error;
    }

    const body = {
      model: this.model,
      messages
    };

    if (responseFormat) {
      body.response_format = responseFormat;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": this.appUrl,
        "X-Title": this.appName
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const bodyText = await response.text();
      const error = new Error(`OpenRouter request failed with ${response.status}: ${bodyText}`);
      error.statusCode = response.status;
      throw error;
    }

    return response.json();
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
