# Sophie email voice tools: how they are wired

This was a to-do list of edits to the shared owner-call files. **It is done.** This note records what was added, so the next person to touch those files knows what is Sophie's.

New files (all of the logic):
- `lib/ai/owner-call/owner-email-questions.ts`: the 8 tool names, the switch `AI_OWNER_VOICE_EMAIL_AUTOMATION_ENABLED`, the JSON schemas, one line for Sophie's instructions. No server imports.
- `lib/ai/mcp/tools/owner-email-questions.tools.ts`: what each tool does, as the owner, calling the same Sophie functions the app routes call.
- Tests: `scripts/test-ai-email-voice-tools.ts` (11).

Additive edits in shared files (nothing existing was changed):
- `lib/ai/owner-call/owner-actions.ts`: `"email_automation"` in `PendingKind`; `EMAIL_AUTOMATION_PREPARE_TOOLS` in `OWNER_PREPARE_TOOL_NAMES`; `...EMAIL_AUTOMATION_DEFINITIONS` in `OWNER_ACTION_DEFINITIONS`.
- `lib/ai/mcp/tools/owner-actions.tools.ts`: an `emailAutomation(name, args)` method, and one branch in `confirm()` for the `email_automation` pending kind.
- `lib/ai/owner-call/tools.ts`: the tools in `ACTION_RUNNERS`, and an `emailAutomation` flag on `ownerVoiceToolList` (offered in both tool modes, with `confirm_owner_change` and `cancel_owner_change`).
- `app/api/ai/owner-call/mcp/route.ts` and `app/api/ai/owner-call/route.ts`: pass the flag, and add `OWNER_EMAIL_AUTOMATION_INSTRUCTIONS` to the session instructions when it is on.
- Voice bridge `bmspro-voice-bridge/src/agents/trade/trade-owner-voice.mjs`: the 8 names in `toolNames`, with a test that no voice tool approves a rule. **Deploy the bridge before the app.**

What the tools can never do: approve a new rule or template, or make a rule automatic (those are done in the app); and the tools take no business or owner argument (both come from the login).
