/**
 * What `npm run dev` runs: the app, plus the scheduled jobs that Vercel's cron would run in production
 * (nothing runs them on your computer). Opt in with these lines in .env.local:
 *
 *   DEV_RUN_CRONS=true     every job in vercel.json on its schedule, Sophie's two every minute
 *                          (includes overdue-invoices and sophie-callbacks: real emails and calls)
 *   or, without that line, Sophie's email assistant alone when AI_AGENT_ENABLED=true
 *
 * Without CRON_SECRET it is just `next dev`. Press Ctrl+C once to stop both. `npm run dev:plain`
 * starts only the app. Optional: DEV_CRONS_SKIP=overdue-invoices,sophie-callbacks
 */

import { spawn } from "node:child_process";

const children = [];
const run = (command, args) => {
  const child = spawn(command, args, { stdio: "inherit", shell: true });
  children.push(child);
  return child;
};

const app = run("npx", ["next", "dev", "--port", "3001"]);

const env = (name) => process.env[name]?.trim();
const hasSecret = !!env("CRON_SECRET");
const everything = hasSecret && env("DEV_RUN_CRONS") === "true";
const sophieOnly = hasSecret && !everything && env("AI_AGENT_ENABLED") === "true";

let timer = null;
if (everything) {
  const skip = env("DEV_CRONS_SKIP");
  console.log("[dev] Running ALL scheduled jobs against this app, including overdue-invoices (emails customers) and sophie-callbacks (places calls).");
  // The app needs a little while before it can answer; the runner keeps trying after that.
  timer = setTimeout(() => run("node", ["--env-file-if-exists=.env.local", "scripts/cron-runner.mjs", "--fast=email-sync,agent-run", ...(skip ? [`--skip=${skip}`] : [])]), 25_000);
} else if (sophieOnly) {
  console.log("[dev] Sophie's email assistant will run every 60 seconds once the app is up.");
  timer = setTimeout(() => run("node", ["--env-file-if-exists=.env.local", "scripts/sophie-tick.mjs", "watch"]), 25_000);
}

const stop = () => {
  if (timer) clearTimeout(timer);
  for (const child of children) if (!child.killed) child.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", stop);
