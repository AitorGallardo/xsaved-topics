/**
 * Tracks token usage and calculates cost across multiple API calls,
 * across multiple models (the pipeline uses Sonnet for taxonomy and
 * Haiku for labeling, so we track each separately and sum).
 */

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": { inputPer1M: 0.80, outputPer1M: 4.00 },
  "claude-sonnet-4-6": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "claude-opus-4-6": { inputPer1M: 15.00, outputPer1M: 75.00 },
};

interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  callCount: number;
}

export class CostTracker {
  private usage = new Map<string, ModelUsage>();

  /** Record tokens from one API call for the given model. */
  addUsage(model: string, inputTokens: number, outputTokens: number): void {
    if (!PRICING[model]) {
      throw new Error(`Unknown model pricing: ${model}. Add it to PRICING in cost-tracker.ts`);
    }

    const current = this.usage.get(model) ?? { inputTokens: 0, outputTokens: 0, callCount: 0 };
    current.inputTokens += inputTokens;
    current.outputTokens += outputTokens;
    current.callCount += 1;
    this.usage.set(model, current);
  }

  private costFor(model: string, usage: ModelUsage): { input: number; output: number; total: number } {
    const pricing = PRICING[model];
    const input = (usage.inputTokens / 1_000_000) * pricing.inputPer1M;
    const output = (usage.outputTokens / 1_000_000) * pricing.outputPer1M;
    return { input, output, total: input + output };
  }

  get totalCost(): number {
    let total = 0;
    for (const [model, usage] of this.usage) {
      total += this.costFor(model, usage).total;
    }
    return total;
  }

  /** Print a formatted cost summary, broken down per model. */
  printSummary(): void {
    console.log(`\n--- Cost Summary ---`);

    for (const [model, usage] of this.usage) {
      const cost = this.costFor(model, usage);
      console.log(`  ${model}`);
      console.log(`    API calls:     ${usage.callCount}`);
      console.log(
        `    Input tokens:  ${usage.inputTokens.toLocaleString()} → $${cost.input.toFixed(4)}`
      );
      console.log(
        `    Output tokens: ${usage.outputTokens.toLocaleString()} → $${cost.output.toFixed(4)}`
      );
      console.log(`    Subtotal:      $${cost.total.toFixed(4)}`);
    }

    console.log(`  ─────────────────`);
    console.log(`  Grand total:     $${this.totalCost.toFixed(4)}`);
  }
}
