/**
 * Runs Sophie's email assistant once against a running app, the same way Vercel's cron jobs do.
 *
 *   npm run sophie:tick                 sync the mailbox, then let Sophie work
 *   npm run sophie:tick -- summary      also build the daily summary now
 *   npm run sophie:watch                keep going: run every 60 seconds until you press Ctrl+C
 *   npm run sophie:tick -- --url=http://localhost:3001
 *
 * Needs the app running (npm run dev) and CRON_SECRET in .env.local. Nothing here changes any switch:
 * with the dry-run switches on (the default) Sophie only sorts and asks.
 */

const args = process.argv.slice(2);
const base = (args.find((arg) => arg.startsWith("--url="))?.slice(6) ?? process.env.SOPHIE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const secret = process.env.CRON_SECRET?.trim();
if (!secret) {
  console.error("CRON_SECRET isn't set. Run it as: npm run sophie:tick (it reads .env.local).");
  process.exit(1);
}

const steps = [
  ["email-sync", "Reading new mail"],
  ["agent-run", "Sophie sorts and acts"],
  ...(args.includes("summary") ? [["email-daily-summary", "Daily summary (only if it is due)"]] : []),
];

async function once() {
for (const [path, label] of steps) {
  process.stdout.write(`${label}... `);
  try {
    const response = await fetch(`${base}/api/cron/${path}`, { headers: { Authorization: `Bearer ${secret}` } });
    const text = await response.text();
    console.log(response.status, text.length > 400 ? `${text.slice(0, 400)}…` : text);
    if (!response.ok) process.exitCode = 1;
  } catch (error) {
    console.log(`failed: ${error instanceof Error ? error.message : error}`);
    console.error(`Is the app running at ${base}? Start it with: npm run dev`);
    return false;
  }
}

  return true;
}

if (args.includes("watch")) {
  console.log("Watching: Sophie runs every 60 seconds. Press Ctrl+C to stop.");
  for (;;) {
    console.log(`
[${new Date().toLocaleTimeString()}]`);
    await once();
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
} else if (!(await once())) {
  process.exit(1);
}
