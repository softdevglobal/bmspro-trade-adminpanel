import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { codeFlags } from "../lib/ai/email/classify";
import { readTriageHeaders } from "../lib/ai/email/headers";
import { machineSignals } from "../lib/ai/email/precheck";
import { replyCommand } from "../lib/ai/email/replies";

/**
 * The test emails (scripts/fixtures/sophie-test-emails.json, shown by `npm run sophie:emails` and
 * written up in docs/sophie-test-emails.md). Checks they are complete and that what the code can
 * decide about them without an AI (flags, machine mail, STOP and "person") matches what the guide says.
 */

type Fixture = {
  cast: { role: string; address: string }[];
  emails: { id: string; tests: string[]; from: string; cc?: string; subject: string; body: string; headers?: Record<string, string>; flags: string[]; expect: string; group: string }[];
  automatedOnly: { tests: string[]; what: string; where: string }[];
};
const data = JSON.parse(readFileSync(new URL("./fixtures/sophie-test-emails.json", import.meta.url), "utf8")) as Fixture;
const address = (role: string) => data.cast.find((person) => person.role === role)?.address ?? "";
const email = (id: string) => data.emails.find((item) => item.id === id)!;

test("every email has a sender from the cast, a unique id, a subject, a body and an expected result", () => {
  assert.ok(data.emails.length >= 70, `${data.emails.length} emails`);
  assert.equal(new Set(data.emails.map((item) => item.id)).size, data.emails.length, "unique ids");
  const roles = new Set(data.cast.map((person) => person.role));
  for (const item of data.emails) {
    assert.ok(roles.has(item.from), `${item.id}: sender ${item.from}`);
    assert.ok(item.subject.length > 2 && item.body.length > 2 && item.expect.length > 20, item.id);
    assert.ok(item.group && Array.isArray(item.tests) && Array.isArray(item.flags), item.id);
  }
  for (const person of data.cast) assert.match(person.address, /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i, person.role);
});

test("every acceptance test T01 to T70 is either an email to send or named as automated (or not built)", () => {
  const covered = new Set([...data.emails.flatMap((item) => item.tests), ...data.automatedOnly.flatMap((row) => row.tests)]);
  const missing = Array.from({ length: 70 }, (_, index) => `T${String(index + 1).padStart(2, "0")}`).filter((id) => !covered.has(id));
  assert.deepEqual(missing, []);
  for (const row of data.automatedOnly) assert.ok(row.what && row.where, row.tests.join(","));
});

test("the fixtures name only test files that exist", async () => {
  const { existsSync } = await import("node:fs");
  const files = new Set(data.automatedOnly.flatMap((row) => row.where.split(/,| and /).map((part) => part.trim()).filter((part) => part.startsWith("test-ai-email-"))));
  for (const file of files) assert.ok(existsSync(new URL(`./${file.replace(/\.ts.*/, ".ts")}`, import.meta.url)), file);
});

test("what the code flags without an AI matches the guide: instructions to Sophie and bank changes", () => {
  for (const item of data.emails) {
    assert.deepEqual(codeFlags(item.subject, item.body), item.flags, `${item.id} ${item.subject}`);
  }
  assert.deepEqual(email("E90").flags, ["asks_to_change_rules"]);
  assert.deepEqual(email("E71").flags, ["bank_change"]);
});

test("machine mail is recognised from its headers and subject, so it is never answered", () => {
  const signals = (id: string) => {
    const item = email(id);
    const headers = readTriageHeaders({ headers: Object.entries(item.headers ?? {}).map(([name, value]) => ({ name: name.toLowerCase(), value })), labels: [], inferenceClassification: null });
    return machineSignals({ from: `${address(item.from)}`, subject: item.subject, headers });
  };
  assert.ok(signals("E80").includes("auto_replied"), "an out-of-office reply");
  assert.ok(signals("E80").includes("out_of_office"));
  assert.ok(signals("E81").includes("bulk"), "a bulk sender");
  assert.ok(signals("E83").includes("bounce"), "a bounce");
  for (const id of ["E10", "E30", "E50", "E70", "E82"]) assert.ok(!signals(id).some((signal) => ["auto_replied", "auto_generated", "bounce", "out_of_office"].includes(signal)), `${id} is a real person's or a marketing email, not machine mail`);
});

test("STOP and “person” are read as the first words of a reply", () => {
  assert.equal(replyCommand(email("E92").body), "stop");
  assert.equal(replyCommand(email("E93").body), "person");
  for (const item of data.emails.filter((candidate) => !["E92", "E93"].includes(candidate.id))) assert.equal(replyCommand(item.body), null, item.id);
});

test("the guide in docs/ matches the fixtures", () => {
  const guide = readFileSync(new URL("../docs/sophie-test-emails.md", import.meta.url), "utf8");
  for (const item of data.emails) assert.ok(guide.includes(`#### ${item.id}: ${item.subject}`), `${item.id} is in the guide (run: npm run sophie:emails -- --md)`);
});
