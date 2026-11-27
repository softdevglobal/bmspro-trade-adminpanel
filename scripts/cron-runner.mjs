/**
 * Runs the app's scheduled jobs (the "crons" in vercel.json) against a running app.
 *
 *   node scripts/cron-runner.mjs                       every job, on its vercel.json schedule (UTC)
 *   node scripts/cron-runner.mjs --url=https://app     a deployed app (for AWS: run this on the server)
 *   node scripts/cron-runner.mjs --fast=email-sync,agent-run   run these every minute instead
 *   node scripts/cron-runner.mjs --skip=overdue-invoices,sophie-callbacks
 *
 * On Vercel the platform does this; anywhere else (your computer, AWS) something has to. Every job
 * is called with CRON_SECRET, never overlaps itself, and is safe to run twice. Supports the
 * schedules used in vercel.json: "*", "*\/n" and a fixed number in the minute and hour fields.
 *
 * WARNING: this includes overdue-invoices (emails real customers) and sophie-callbacks (places real
 * calls). Point it only at data you are happy to act on.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const list = (value) => (value ? value.split(",").map((item) => item.trim()).filter(Boolean) : []);

const base = (option("url") ?? process.env.SOPHIE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const fast = new Set(list(option("fast")));
const skip = new Set(list(option("skip")));
const secret = process.env.CRON_SECRET?.trim();
if (!secret) {
  console.error("[cron] CRON_SECRET isn't set (it is read from .env.local).");
  process.exit(1);
}

/** One field of a cron expression: "*", "*\/5" or "30". Returns a test, or null when unsupported. */
function field(text) {
  if (text === "*") return () => true;
  const step = /^\*\/(\d+)$/.exec(text);
  if (step && Number(step[1]) > 0) return (value) => value % Number(step[1]) === 0;
  if (/^\d+$/.test(text)) return (value) => value === Number(text);
  return null;
}

const jobs = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")).crons
  .map(({ path, schedule }) => {
    const name = path.replace(/^\/api\/cron\//, "");
    const [minute, hour, ...rest] = schedule.split(/\s+/);
    const tests = [field(minute), field(hour)];
    if (!tests[0] || !tests[1] || rest.some((part) => part !== "*")) {
      console.warn(`[cron] ${name}: unsupported schedule "${schedule}", skipped.`);
      return null;
    }
    return { name, path, schedule, due: fast.has(name) ? () => true : (date) => tests[0](date.getUTCMinutes()) && tests[1](date.getUTCHours()) };
  })
  .filter((job) => job && !skip.has(job.name));

const running = new Set();
async function call(job) {
  if (running.has(job.name)) return;
  running.add(job.name);
  const started = Date.now();
  try {
    const response = await fetch(`${base}${job.path}`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(310_000) });
    const text = await response.text();
    const brief = text.length > 160 ? `${text.slice(0, 160)}…` : text;
    console.log(`[cron ${new Date().toLocaleTimeString()}] ${job.name} ${response.status} ${Date.now() - started}ms ${response.ok ? "" : brief}`);
  } catch (error) {
    // The app may still be starting; the next due run tries again.
    console.log(`[cron ${new Date().toLocaleTimeString()}] ${job.name} failed: ${error instanceof Error ? error.message : error}`);
  } finally {
    running.delete(job.name);
  }
}

console.log(`[cron] ${jobs.length} jobs against ${base}: ${jobs.map((job) => `${job.name}${fast.has(job.name) ? " (every minute)" : ""}`).join(", ")}`);

let last = -1;
setInterval(() => {
  const now = new Date();
  const minute = Math.floor(now.getTime() / 60_000);
  if (minute === last) return;
  last = minute;
  for (const job of jobs) if (job.due(now)) void call(job);
}, 5_000);
