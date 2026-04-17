import ora, { type Ora } from "ora";
import chalk from "chalk";

let spinner: Ora | null = null;

export const cli = {
  header(text: string) {
    this.stop();
    console.log(`\n${chalk.bold.cyan("━".repeat(50))}`);
    console.log(chalk.bold.cyan(`  ${text}`));
    console.log(chalk.bold.cyan("━".repeat(50)));
  },

  subheader(text: string) {
    this.stop();
    console.log(`\n${chalk.bold(text)}`);
  },

  info(text: string) {
    this.stop();
    console.log(chalk.dim(`  ${text}`));
  },

  success(text: string) {
    this.stop();
    console.log(chalk.green(`  ✓ ${text}`));
  },

  warn(text: string) {
    this.stop();
    console.log(chalk.yellow(`  ⚠ ${text}`));
  },

  error(text: string) {
    this.stop();
    console.log(chalk.red(`  ✗ ${text}`));
  },

  progress(current: number, total: number, detail: string) {
    const pct = Math.round((current / total) * 100);
    const filled = Math.round((current / total) * 20);
    const bar = chalk.green("█".repeat(filled)) + chalk.dim("░".repeat(20 - filled));
    this.stop();
    console.log(`  ${bar} ${chalk.dim(`${current}/${total}`)} ${pct}% ${chalk.dim(detail)}`);
  },

  spin(text: string) {
    if (spinner) spinner.text = text;
    else spinner = ora({ text, color: "cyan" }).start();
  },

  stop() {
    if (spinner) {
      spinner.stop();
      spinner = null;
    }
  },

  score(label: string, value: number, max: number = 10) {
    const color = value >= 7 ? chalk.green : value >= 5 ? chalk.yellow : chalk.red;
    console.log(`  ${chalk.dim(label)} ${color(`${value}/${max}`)}`);
  },

  table(rows: [string, string][]) {
    const maxLabel = Math.max(...rows.map(([l]) => l.length));
    for (const [label, value] of rows) {
      console.log(`  ${chalk.dim(label.padEnd(maxLabel + 2))}${value}`);
    }
  },

  blank() {
    this.stop();
    console.log();
  },
};
