/**
 * Tracks token usage and calculates cost across multiple API calls.
 *
 * Pricing is per 1 million tokens. Each model has different rates.
 * We store the prices here so cost calculation is centralized.
 */

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": { inputPer1M: 0.80, outputPer1M: 4.00 },
  "claude-sonnet-4-6-20260414": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "claude-opus-4-6-20260410": { inputPer1M: 15.00, outputPer1M: 75.00 },
};

export class CostTracker {
  private model: string;
  private pricing: ModelPricing;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private callCount = 0;

  constructor(model: string) {
    this.model = model;
    this.pricing = PRICING[model];
    if (!this.pricing) {
      throw new Error(`Unknown model pricing: ${model}. Add it to PRICING in cost-tracker.ts`);
    }
  }

  /** Record tokens from one API call. */
  addUsage(inputTokens: number, outputTokens: number): void {
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.callCount++;
  }

  /** Calculate cost in dollars for a given token count and rate. */
  private calcCost(tokens: number, pricePer1M: number): number {
    return (tokens / 1_000_000) * pricePer1M;
  }

  get inputCost(): number {
    return this.calcCost(this.totalInputTokens, this.pricing.inputPer1M);
  }

  get outputCost(): number {
    return this.calcCost(this.totalOutputTokens, this.pricing.outputPer1M);
  }

  get totalCost(): number {
    return this.inputCost + this.outputCost;
  }

  /** Print a formatted cost summary to the console. */
  printSummary(): void {
    console.log(`\n--- Cost Summary (${this.model}) ---`);
    console.log(`  API calls:     ${this.callCount}`);
    console.log(`  Input tokens:  ${this.totalInputTokens.toLocaleString()} → $${this.inputCost.toFixed(4)}`);
    console.log(`  Output tokens: ${this.totalOutputTokens.toLocaleString()} → $${this.outputCost.toFixed(4)}`);
    console.log(`  Total cost:    $${this.totalCost.toFixed(4)}`);
  }
}
