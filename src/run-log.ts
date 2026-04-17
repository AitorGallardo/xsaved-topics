import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

const OUTPUT_DIR = new URL("../output/", import.meta.url);
const LOG_PATH = new URL("../output/run-log.json", import.meta.url);

interface RunEntry {
  timestamp: string;
  bookmarks: number;
  classified: number;
  unclassified: number;
  rejected: number;
  hallucinations: number;
  taxonomyScore: number | null;
  taxonomyIterations: number;
  topicCount: number;
  totalCost: number;
  elapsedSeconds: number;
  auditAccuracy: number | null;
}

export function appendRunLog(entry: RunEntry): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  let log: RunEntry[] = [];
  if (existsSync(LOG_PATH)) {
    try {
      log = JSON.parse(readFileSync(LOG_PATH, "utf-8"));
    } catch {
      log = [];
    }
  }

  log.push(entry);
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}
