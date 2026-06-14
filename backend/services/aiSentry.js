const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TOKEN_DECIMALS = 18;
const DEFAULT_SCHEDULE_WINDOW_DAYS = 30;
const MAX_RUNWAY_DAYS = 36500;

const FAILED_STATUSES = new Set(["failed", "skipped", "held", "rejected", "cancelled", "canceled"]);
const NON_SPEND_EVENT_TYPES = new Set([
  "qiedex_swap",
  "qiedex_liquidity_engine",
  "qusdc_balance_check"
]);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundNumber(value, decimals = 6) {
  if (!Number.isFinite(value)) {
    return value;
  }

  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function toFiniteNumber(value, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "bigint") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function fromBaseUnits(value, decimals = DEFAULT_TOKEN_DECIMALS) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  try {
    const normalizedDecimals = Math.max(0, Number.parseInt(decimals, 10) || DEFAULT_TOKEN_DECIMALS);
    const raw = typeof value === "bigint" ? value : BigInt(String(value).trim());
    const sign = raw < 0n ? -1 : 1;
    const absoluteRaw = raw < 0n ? -raw : raw;
    const divisor = 10n ** BigInt(normalizedDecimals);
    const whole = absoluteRaw / divisor;
    const fractional = absoluteRaw % divisor;

    return sign * (Number(whole) + Number(fractional) / Number(divisor));
  } catch (_error) {
    return toFiniteNumber(value);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function lowerString(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function shouldCountSpend(record) {
  if (!isPlainObject(record)) {
    return true;
  }

  const status = lowerString(record.status);
  if (FAILED_STATUSES.has(status)) {
    return false;
  }

  const eventType = lowerString(record.eventType || record.type);
  if (NON_SPEND_EVENT_TYPES.has(eventType)) {
    return false;
  }

  const interactionType = lowerString(record.interactionType || record.contractFunction);
  if (eventType === "contract_interaction" && interactionType && interactionType !== "executepayment") {
    return false;
  }

  const action = lowerString(record.action || record.decision?.action);
  if (action === "hold") {
    return false;
  }

  return true;
}

function shouldTreatAmountAsBaseUnits(record, value) {
  if (!isPlainObject(record)) {
    return false;
  }

  const unit = lowerString(record.unit || record.unitsLabel || record.denomination);
  if (unit === "wei" || unit === "base" || unit === "base_units") {
    return true;
  }
  if (record.amountIsWei || record.baseUnits || record.rawAmount) {
    return true;
  }

  const eventType = lowerString(record.eventType || record.type);
  const interactionType = lowerString(record.interactionType || record.contractFunction);
  if (eventType === "contract_interaction" && interactionType === "executepayment") {
    return true;
  }

  return typeof value === "bigint";
}

function amountFromRecord(record) {
  if (record === undefined || record === null) {
    return 0;
  }
  if (!isPlainObject(record)) {
    return Math.max(0, toFiniteNumber(record));
  }
  if (!shouldCountSpend(record)) {
    return 0;
  }

  const decimals = firstDefined(record.decimals, record.tokenDecimals, DEFAULT_TOKEN_DECIMALS);
  const explicitQusdcAmount = firstDefined(
    record.qusdcAmount,
    record.amountQusdc,
    record.spendQusdc,
    record.paymentQusdc,
    record.costQusdc,
    record.valueQusdc
  );
  if (explicitQusdcAmount !== undefined) {
    return Math.max(0, toFiniteNumber(explicitQusdcAmount));
  }

  const baseUnitAmount = firstDefined(
    record.amountWei,
    record.spendWei,
    record.paymentWei,
    record.valueWei,
    record.transaction?.executePayment?.amountWei,
    record.executePayment?.amountWei
  );
  if (baseUnitAmount !== undefined) {
    return Math.max(0, fromBaseUnits(baseUnitAmount, decimals));
  }

  const genericAmount = firstDefined(record.amount, record.value, record.cost, record.paymentAmount);
  if (genericAmount === undefined) {
    return 0;
  }

  const amount = shouldTreatAmountAsBaseUnits(record, genericAmount)
    ? fromBaseUnits(genericAmount, decimals)
    : toFiniteNumber(genericAmount);

  return Math.max(0, amount);
}

function timestampFromRecord(record) {
  if (!isPlainObject(record)) {
    return null;
  }

  const timestamp = firstDefined(
    record.timestamp,
    record.date,
    record.createdAt,
    record.completedAt,
    record.executedAt,
    record.paidAt,
    record.dueAt
  );
  if (!timestamp) {
    return null;
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcDayStart(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function formatAmount(value) {
  if (!Number.isFinite(value)) {
    return "Infinity";
  }

  return roundNumber(value, 6).toString();
}

function readBalance(state, token) {
  if (!isPlainObject(state)) {
    return 0;
  }

  const decimals = firstDefined(state.decimals, state.tokenDecimals, DEFAULT_TOKEN_DECIMALS);
  const balances = isPlainObject(state.balances) ? state.balances : {};
  const tokenSymbol = token.toUpperCase();
  const tokenBalance = isPlainObject(balances[token])
    ? balances[token]
    : (isPlainObject(balances[tokenSymbol]) ? balances[tokenSymbol] : null);

  const baseUnitValue = token === "qusdc"
    ? firstDefined(
      state.qusdcBalanceWei,
      state.qUSDCBalanceWei,
      state.balanceWei,
      tokenBalance?.amountWei,
      tokenBalance?.balanceWei,
      balances.qusdcWei,
      balances.QUSDCWei
    )
    : firstDefined(
      state.wqieBalanceWei,
      state.wQIEBalanceWei,
      tokenBalance?.amountWei,
      tokenBalance?.balanceWei,
      balances.wqieWei,
      balances.WQIEWei
    );

  if (baseUnitValue !== undefined) {
    return Math.max(0, fromBaseUnits(baseUnitValue, tokenBalance?.decimals || decimals));
  }

  const directValue = token === "qusdc"
    ? firstDefined(
      state.qusdcBalance,
      state.qUSDCBalance,
      state.balance,
      state.balanceQusdc,
      tokenBalance?.amount,
      tokenBalance?.balance,
      balances.qusdc,
      balances.QUSDC
    )
    : firstDefined(
      state.wqieBalance,
      state.wQIEBalance,
      tokenBalance?.amount,
      tokenBalance?.balance,
      balances.wqie,
      balances.WQIE
    );

  return Math.max(0, toFiniteNumber(directValue));
}

function intervalDaysForScheduleItem(item, defaultWindowDays) {
  const explicitDays = firstDefined(item.intervalDays, item.everyDays, item.periodDays, item.windowDays);
  if (explicitDays !== undefined) {
    return Math.max(1, toFiniteNumber(explicitDays, defaultWindowDays));
  }

  const frequency = lowerString(item.frequency || item.cadence || item.period);
  if (frequency === "daily" || frequency === "day") return 1;
  if (frequency === "weekly" || frequency === "week") return 7;
  if (frequency === "biweekly" || frequency === "fortnightly") return 14;
  if (frequency === "monthly" || frequency === "month") return 30;
  if (frequency === "quarterly" || frequency === "quarter") return 91;
  if (frequency === "yearly" || frequency === "annual" || frequency === "annually" || frequency === "year") return 365;

  return Math.max(1, defaultWindowDays);
}

function calculateScheduledDailySpend(schedule, windowDays = DEFAULT_SCHEDULE_WINDOW_DAYS) {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return 0;
  }

  const defaultWindowDays = Math.max(1, toFiniteNumber(windowDays, DEFAULT_SCHEDULE_WINDOW_DAYS));
  const dailySpend = schedule.reduce((total, item) => {
    if (!isPlainObject(item)) {
      return total;
    }

    const amount = amountFromRecord(item);
    if (amount <= 0) {
      return total;
    }

    return total + amount / intervalDaysForScheduleItem(item, defaultWindowDays);
  }, 0);

  return roundNumber(dailySpend);
}

function calculateBurnRate(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return 0;
  }

  let totalSpend = 0;
  const spendDays = [];

  for (const record of history) {
    const amount = amountFromRecord(record);
    if (amount <= 0) {
      continue;
    }

    totalSpend += amount;
    const timestamp = timestampFromRecord(record);
    if (timestamp) {
      spendDays.push(utcDayStart(timestamp));
    }
  }

  if (totalSpend <= 0) {
    return 0;
  }
  if (spendDays.length < 2) {
    return roundNumber(totalSpend);
  }

  const firstDay = Math.min(...spendDays);
  const lastDay = Math.max(...spendDays);
  const inclusiveDays = Math.floor((lastDay - firstDay) / DAY_MS) + 1;

  return roundNumber(totalSpend / Math.max(1, inclusiveDays));
}

function estimateRunway(balance, burnRate) {
  const normalizedBalance = Math.max(0, toFiniteNumber(balance));
  const normalizedBurnRate = Math.max(0, toFiniteNumber(burnRate));

  if (normalizedBurnRate === 0) {
    return normalizedBalance > 0 ? Number.POSITIVE_INFINITY : 0;
  }

  return roundNumber(normalizedBalance / normalizedBurnRate);
}

function computeTreasuryHealth(balance, burnRate, volatilityFactor = 0) {
  const normalizedBalance = Math.max(0, toFiniteNumber(balance));
  const normalizedBurnRate = Math.max(0, toFiniteNumber(burnRate));
  const normalizedVolatility = clamp(toFiniteNumber(volatilityFactor), 0, 1);

  if (normalizedBalance === 0) {
    return 0;
  }
  if (normalizedBurnRate === 0) {
    return Math.round(100 - normalizedVolatility * 20);
  }

  const runwayDays = estimateRunway(normalizedBalance, normalizedBurnRate);
  let runwayScore;

  if (runwayDays >= 90) {
    runwayScore = 100;
  } else if (runwayDays >= 60) {
    runwayScore = 80 + ((runwayDays - 60) / 30) * 20;
  } else if (runwayDays >= 30) {
    runwayScore = 60 + ((runwayDays - 30) / 30) * 20;
  } else if (runwayDays >= 14) {
    runwayScore = 45 + ((runwayDays - 14) / 16) * 15;
  } else if (runwayDays >= 7) {
    runwayScore = 25 + ((runwayDays - 7) / 7) * 20;
  } else {
    runwayScore = (runwayDays / 7) * 25;
  }

  return Math.round(clamp(runwayScore - normalizedVolatility * 20, 0, 100));
}

function riskLevelForHealth(treasuryHealth) {
  if (treasuryHealth >= 80) return "LOW";
  if (treasuryHealth >= 50) return "MEDIUM";
  return "HIGH";
}

function recommendationForState({ riskLevel, wqieBalance }) {
  if (riskLevel === "LOW") {
    return "HOLD";
  }
  if (riskLevel === "MEDIUM" && wqieBalance > 0) {
    return "SWAP_PREPARATION";
  }

  return "REDUCE_SPEND";
}

function explanationForDecision({ treasuryHealth, runwayDays, burnRate, riskLevel, recommendation, scheduledBurnRate }) {
  const runwayText = Number.isFinite(runwayDays) ? `${formatAmount(runwayDays)} days` : "unlimited days";
  const scheduleText = scheduledBurnRate > 0
    ? ` Scheduled payments imply at least ${formatAmount(scheduledBurnRate)} QUSDC/day.`
    : "";

  return [
    `Treasury health is ${treasuryHealth}/100 with ${runwayText} of QUSDC runway at ${formatAmount(burnRate)} QUSDC/day.`,
    `Risk is ${riskLevel}, so the analytical recommendation is ${recommendation}.`,
    "No blockchain transaction is executed by AI Sentry.",
    scheduleText
  ].join(" ").replace(/\s+/g, " ").trim();
}

function generateRecommendation(state = {}) {
  const qusdcBalance = readBalance(state, "qusdc");
  const wqieBalance = readBalance(state, "wqie");
  const history = firstDefined(
    state.history,
    state.spendHistory,
    state.historicalSpend,
    state.historicalSpendData,
    []
  );
  const schedule = firstDefined(
    state.schedule,
    state.paymentSchedule,
    state.subscriptionSchedule,
    state.subscriptions,
    []
  );

  const historicalBurnRate = state.burnRate !== undefined
    ? Math.max(0, toFiniteNumber(state.burnRate))
    : calculateBurnRate(history);
  const scheduledBurnRate = calculateScheduledDailySpend(schedule, state.scheduleWindowDays);
  const burnRate = roundNumber(Math.max(historicalBurnRate, scheduledBurnRate));
  const volatilityFactor = clamp(toFiniteNumber(state.volatilityFactor), 0, 1);
  const estimatedRunway = estimateRunway(qusdcBalance, burnRate);
  const runwayDays = Number.isFinite(estimatedRunway) ? roundNumber(estimatedRunway) : MAX_RUNWAY_DAYS;
  const treasuryHealth = computeTreasuryHealth(qusdcBalance, burnRate, volatilityFactor);
  const riskLevel = riskLevelForHealth(treasuryHealth);
  const recommendation = recommendationForState({ riskLevel, wqieBalance });

  return {
    treasuryHealth,
    runwayDays,
    burnRate: `${formatAmount(burnRate)} QUSDC/day`,
    riskLevel,
    recommendation,
    explanation: explanationForDecision({
      treasuryHealth,
      runwayDays,
      burnRate,
      riskLevel,
      recommendation,
      scheduledBurnRate
    })
  };
}

module.exports = {
  calculateBurnRate,
  estimateRunway,
  computeTreasuryHealth,
  generateRecommendation
};
