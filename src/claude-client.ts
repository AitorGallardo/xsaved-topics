import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

/**
 * Create and export a single Anthropic client instance.
 *
 * The SDK automatically reads ANTHROPIC_API_KEY from process.env,
 * so we just need dotenv to load the .env file first.
 *
 * We create one client and reuse it — it handles connection pooling internally.
 */
export const anthropic = new Anthropic();
