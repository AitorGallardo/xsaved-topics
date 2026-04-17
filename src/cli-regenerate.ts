/**
 * Force regenerate: deletes existing taxonomy and runs full pipeline.
 * Run: npm run regenerate
 */
import { existsSync, unlinkSync } from "fs";
import { cli } from "./cli.js";

const TAXONOMY_PATH = new URL("../output/taxonomy.json", import.meta.url);

if (existsSync(TAXONOMY_PATH)) {
  unlinkSync(TAXONOMY_PATH);
  cli.info("Deleted existing taxonomy.json");
}

// Re-export to the full pipeline
await import("./index.js");
