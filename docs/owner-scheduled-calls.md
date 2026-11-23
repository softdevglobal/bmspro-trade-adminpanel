# Owner-requested scheduled Sophie calls

The owner can ask Talk to Sophie to schedule a call to a saved customer and give its purpose and questions. Categories are service, complaint, quotation, invoice or other. The existing scheduled-call worker places it later; this adds no worker or polling loop.

## Deploy and enable

The feature is off by default. Deploy the bridge files BEFORE enabling Trade:

- `src/agents/trade/trade-owner-voice.mjs` — allow the two owner tools.
- `src/agents/trade/trade-sophie-callback.mjs` — validate and carry the owner task into the one-time outbound media context.
- `src/agents/trade/trade-owner-requested-call.mjs` — focused conversation instructions.
- `src/observability/call-record.mjs` — mark owner-call logs for schedule linking.
- `src/server/bridge.mjs` — the owner-call endpoint and live call routing.

A package with exactly these paths is generated at `D:/Softdev Global/voice-bridge/owner-scheduled-calls-bridge.tar.gz`.

Windows PowerShell:

```powershell
scp "D:\Softdev Global\voice-bridge\owner-scheduled-calls-bridge.tar.gz" dev@100.88.220.83:/home/dev/
```

Server (stop the existing bridge when no calls are active, then extract into its actual checkout):

```bash
cd ~/bmspro-voice-bridge-main
tar -tzf ~/owner-scheduled-calls-bridge.tar.gz
tar -xzf ~/owner-scheduled-calls-bridge.tar.gz
node --check src/server/bridge.mjs
node --env-file="$HOME/bmspro-voice-bridge/.env" \
  --env-file="$HOME/bmspro-voice-bridge/.env.trade-direct-pilot" \
  bridge.mjs
```

Trade server environment:

```env
AI_OWNER_VOICE_SCHEDULED_CALLS_ENABLED=true
AI_SOPHIE_CALLBACK_ENABLED=true
```

Call logging must remain enabled (`AI_VOICE_CALL_LOGS_ENABLED` must not be `false`). The bridge's existing callback/AMI configuration, the business DID's callback route and the existing cron/dev scheduler must already work. Restart Trade and open a NEW Talk to Sophie session. Deploy `firestore.rules` through the normal release process: `ai_scheduled_callbacks` is now explicitly Admin-SDK-only, with owner access through the authenticated API.

The existing job/inspection flag is independent. No new bridge environment variable is needed. Keep real owner-call scheduling disabled until the matching bridge files are deployed.

## Owner experience

1. Say: "Schedule a call to John Smith on Monday at 3 PM. Ask whether the repair resolved his complaint and what still needs attention."
2. Sophie finds the exact saved customer. For duplicate names, she asks for the saved email; she cannot accept a guessed number, customer ID or another business's customer.
3. She reads back the customer, phone ending, business number, local date/time and exact purpose/questions. Say no to discard it, or yes to save it.
4. Open Calls → Scheduled calls and select the scheduled date. The row shows Owner-requested call, category and instructions.
5. A scheduled owner call can be cancelled there before the worker claims it. Cancellation and worker claiming race in a transaction. Once dialing starts, the cancel button cannot recall it.
6. After the call ends and its log arrives, select **View conversation and response**. This loads the existing authenticated call log on demand, including both Sophie's questions and the caller's actual responses. It does not create a second transcript copy with a different retention period. Deleted or expired logs are unavailable.

The call is scheduled within 30 days and within the business's configured Sophie calling hours. The existing minute poll/cron cadence and bridge capacity mean the requested time is not an exact-time guarantee. A busy bridge defers the attempt; owner calls expire two hours after their requested time instead of unexpectedly running the next day. Ambiguous call results are not automatically re-dialed.

## Conversation and safeguards

Sophie introduces herself, asks for the intended customer and whether they can speak, and only then discusses the owner-provided purpose. Voicemail/wrong-person calls must not disclose complaint, quotation or invoice details. The focused call has callback/opt-out/end tools, with no booking, quotation, payment or record-change tools. Owner instructions are question context, not verified financial facts or authority to override these rules. No payment credentials, promises, refunds or changes are collected/applied. "I paid" is a caller claim for owner review, not a verified payment.

Saved contact membership, phone and version are checked before the owner confirms. At dialing, the worker checks the business route, current owner, customer membership/name/phone, opt-out, feature/log flags, calling hours and expiry. A transactional claim plus bridge request ID prevents duplicate execution of the same scheduled attempt.

A customer can ask to call later during this call; the existing after-hangup scheduling endpoint carries the same purpose/questions into the follow-up. A request not to call again uses the existing business-specific opt-out and blocks later calls. Neither needs the owner to approve it again.

Only a call log with matching schedule attempt, business, DID and caller phone is linked. Phone answered does not prove the right person answered; the UI labels caller statements as requiring review. Transcript capture depends on successful call setup and log delivery; failures remain visible as failed/unverified or a missing conversation rather than a fabricated answer.

## Checks

```powershell
npx tsx --import ./scripts/stub-server-only.mjs --test scripts/test-owner-scheduled-calls.ts scripts/test-ai-owner-call.ts scripts/test-owner-visits.ts scripts/test-ai-call-logs.ts scripts/test-owner-call-now.ts scripts/test-firestore-read-reductions.ts
```

Bridge:

```bash
node --test tests/owner-requested-call.test.mjs tests/owner-voice.test.mjs tests/sophie-callback.test.mjs tests/call-record.test.mjs
```

These use fixtures, fake dialing and mocked HTTP/Firestore; no real customer is called. Manual validation after deployment: decline a proposal, confirm one to a test customer, cancel a future call, ask to call later during a test call, ask not to be called again, verify private details are withheld for the wrong person, and check the logged response under Scheduled calls. Verify existing missed-call and overdue-invoice callbacks still work.
