/**
 * Sophie's test emails (scripts/fixtures/sophie-test-emails.json), one source for everything.
 *
 *   npm run sophie:emails                 list every test email
 *   npm run sophie:emails -- E10          print one, ready to copy into your mail client
 *   npm run sophie:emails -- --group Complaints
 *   npm run sophie:emails -- --md         rewrite docs/sophie-test-emails.md from the fixtures
 *
 * Send them FROM a second mailbox you control (see the cast in the guide) TO the business mailbox
 * that Sophie sorts. Nothing here sends mail.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(root, "scripts/fixtures/sophie-test-emails.json"), "utf8"));
const people = new Map(data.cast.map((person) => [person.role, person]));
const who = (role) => { const person = people.get(role); return person ? `${person.name} <${person.address}>` : role; };

function show(email) {
  const lines = [
    `${email.id}  ${email.subject}`,
    `From:     ${who(email.from)}`,
    `To:       ${data.business.address}`,
    ...(email.cc ? [`Cc:       ${email.cc}`] : []),
    ...(email.replyTo ? [`Reply-To: ${email.replyTo}`] : []),
    ...Object.entries(email.headers ?? {}).map(([key, value]) => `${key}: ${value}   (custom header)`),
    `Subject:  ${email.subject}`,
    "",
    email.body,
    "",
    ...(email.setup ? [`SET UP FIRST: ${email.setup}`] : []),
    `EXPECT:   ${email.expect}`,
    ...(email.tests.length ? [`TESTS:    ${email.tests.join(", ")}`] : []),
  ];
  return lines.join("\n");
}

function markdown() {
  const groups = [...new Set(data.emails.map((email) => email.group))];
  const out = [];
  out.push("# Sophie email assistant: test emails and how to run them", "",
    "> Generated from `scripts/fixtures/sophie-test-emails.json` by `npm run sophie:emails -- --md`. Edit the JSON, not this file.", "",
    "## 1. Run it", "",
    "```powershell",
    "# Terminal 1: the app (http://localhost:3001)",
    "npm run dev",
    "",
    "# Terminal 2: after you send test emails, run Sophie once (reads .env.local, same as the cron jobs)",
    "npm run sophie:tick",
    "npm run sophie:tick -- summary     # also builds the daily summary",
    "```", "",
    "Then open **Emails → Sophie** in the app. Cards appear there; answer them, and run `npm run sophie:tick` again to carry the actions out (in real use the cron does this every 5 minutes).", "",
    "**Other commands**", "",
    "```powershell",
    "npm run sophie:emails                # list the test emails below",
    "npm run sophie:emails -- E50         # print one, ready to copy",
    "npm run test:sophie                  # every automated Sophie test (no mailbox or AI key needed)",
    "npm run test:ai-email                # just the email tests",
    "npm run report:email-shadow          # how often Sophie's guess matched your answer (practice mode)",
    "npm run test:rules                   # Firestore rules (needs the Firebase emulator)",
    "```", "",
    "## 2. Set up once", "",
    "1. `.env.local` has the Sophie switches (already added): `AI_AGENT_ENABLED=true`, `AI_EMAIL_TRIAGE_ENABLED=true`, and both `..._DRY_RUN=true`. In this **practice mode** Sophie sorts and asks; the cards say \"Here's what I would have done\" and **nothing is done or sent**. Start here.",
    "2. Connect the business mailbox (Settings → Emails). Use a test mailbox, not your real one.",
    "3. Settings → Sophie: switch on **Sophie sorts new email**. **Only mail that arrives AFTER you switch it on is sorted** (so send the test emails after this).",
    "4. Settings → Business: set your **working hours** and **open days**, or the 'are you open?' emails will (correctly) not be answered.",
    "5. Mark the **Friend** sender below as **private** (Settings → Sophie → Private senders) before sending E85.",
    "6. Create the records in the cast table (Priya's job, invoice and quote) if you want the customer answers to show real details.",
    "7. When practice mode looks right, go live one step at a time: set `AI_EMAIL_TRIAGE_DRY_RUN=false` and `AI_AGENT_DRY_RUN=false` (answers now run), then `AI_EMAIL_AUTO_ENABLED=true` (rules may act), then `AI_EMAIL_AUTO_REPLY_ENABLED=true` (replies). Restart `npm run dev` after each change.", "",
    "## 3. The cast", "",
    "Send each email from a mailbox you control, using the address below as the **From**. (For a real sender you can't spoof, create the customer record with the address of a second mailbox of your own instead, and use that.)", "",
    "| Role | Name and address | What it needs |", "|---|---|---|",
    ...data.cast.map((person) => `| ${person.role} | ${person.name} <${person.address}> | ${person.note} |`), "",
    `The business mailbox that receives them: **${data.business.address}** (${data.business.name}, owner ${data.business.owner}).`, "",
    "## 4. The emails", "",
    `${data.emails.length} emails in ${groups.length} groups. Each shows who sends it, what to set up first, and what you should see. The **Tests** column is the acceptance test in section 18 of the design.`, "");
  for (const group of groups) {
    out.push(`### ${group}`, "");
    for (const email of data.emails.filter((item) => item.group === group)) {
      out.push(`#### ${email.id}: ${email.subject}${email.tests.length ? ` (${email.tests.join(", ")})` : ""}`, "");
      out.push(`- **From:** ${who(email.from)}${email.cc ? `, **Cc:** ${email.cc}` : ""}${email.replyTo ? `, **Reply-To:** ${email.replyTo}` : ""}`);
      for (const [key, value] of Object.entries(email.headers ?? {})) out.push(`- **Custom header:** \`${key}: ${value}\` (needs a mail tool that lets you add headers; otherwise the automated tests cover it)`);
      if (email.setup) out.push(`- **Set up first:** ${email.setup}`);
      if (email.manual) out.push("- **Needs manual set-up** (not just a plain email).");
      out.push(`- **Subject:** ${email.subject}`, "", "```text", email.body, "```", "", `**You should see:** ${email.expect}`, "");
    }
  }
  out.push("## 5. Acceptance tests with no email to send", "",
    "These are covered by automated tests (`npm run test:sophie`):", "",
    "| Tests | What | Where |", "|---|---|---|",
    ...data.automatedOnly.map((row) => `| ${row.tests.join(", ")} | ${row.what} | ${row.where} |`), "",
    "## 6. A quick path (10 minutes)", "",
    "1. Send **E01, E03, E10, E30, E40, E50, E70, E82, E85, E90** (one of each kind).",
    "2. `npm run sophie:tick`.",
    "3. Emails → Sophie: you should see cards for all but E85 (private, nothing shown) and the machine mail.",
    "4. Answer them, `npm run sophie:tick` again, and check **Done recently**.",
    "5. Send **E95, E96, E97** from the same sender, answering each, to see Sophie offer a rule.", "");
  return out.join("\n");
}

const args = process.argv.slice(2);
if (args.includes("--md")) {
  writeFileSync(join(root, "docs/sophie-test-emails.md"), markdown());
  console.log(`Wrote docs/sophie-test-emails.md (${data.emails.length} emails).`);
} else if (args.includes("--group")) {
  const name = args[args.indexOf("--group") + 1]?.toLowerCase();
  const found = data.emails.filter((email) => email.group.toLowerCase().includes(name ?? "\0"));
  console.log(found.length ? found.map(show).join("\n\n----------------------------------------\n\n") : `No group matching "${name}".`);
} else if (args[0]) {
  const email = data.emails.find((item) => item.id.toLowerCase() === args[0].toLowerCase());
  console.log(email ? show(email) : `No email ${args[0]}. Run without arguments to list them.`);
} else {
  let group = "";
  for (const email of data.emails) {
    if (email.group !== group) { group = email.group; console.log(`\n${group}`); }
    console.log(`  ${email.id}  ${email.tests.join(",").padEnd(11)} ${email.subject}${email.manual ? "   (manual set-up)" : ""}`);
  }
  console.log(`\n${data.emails.length} emails. Print one with: npm run sophie:emails -- E10`);
}
