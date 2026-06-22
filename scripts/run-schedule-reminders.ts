import { runScheduleReminders } from "../lib/scheduling/schedule-reminders";

async function main() {
  console.log("Running schedule reminders…");
  const result = await runScheduleReminders();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
