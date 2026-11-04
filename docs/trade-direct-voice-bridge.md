# Trade voice bridge: dashboard discovery and customer/inspection MCP

## Text call transcripts

The local bridge now saves each call to its own `.txt` file under `./transcripts`
by default, with Caller/Sophie speaker labels and session-time block offsets.
Upload `bridge.mjs` and `call-transcript.mjs` together and restart the existing
bridge to enable this on the server. This includes 410 business owner onboarding
and 403 Trade calls; no Trade or Command Center backend change is required.
Optional bridge settings are `BMSPRO_TRANSCRIPTS_ENABLED=false` to disable future
capture and `BMSPRO_TRANSCRIPTS_DIR` to override the directory. Files update live,
contain recognized speech, and remain on the server until removed. They contain
caller details and should stay out of source control. No audio or tool payloads
are saved. Recognition is approximate; generated assistant text is not proof of
listener-side playback. Tests: `node --test call-transcript.test.mjs`.

## Conversation update

The local bridge prompts now use a warmer greeting, short everyday questions,
one preferred inspection session by default, optional notes/budget, and one final
readback. Answers already supplied are reused. Customer registration is offered
only when the caller wants an account. Trade owner onboarding follows the signup
form fields, with concise live plan choices and no password collection by voice.
Optional logo/photo uploads stay in the web forms. Voice requests now support both
published services and "Not sure / need advice" scopes. Required validation and
explicit consent remain.

To deploy this conversation update, upload `bridge.mjs`, `trade-tools.mjs` and
`onboarding-tools.mjs` from the local bridge directory to the existing server,
then restart the existing bridge process. Keep `trade-action-policy.mjs` from
the customer/booking deployment. No environment or backend change is required.

## Current behavior

The updated bridge adds a local `prepare_inspection_request` function before the
final readback. It holds validated call details without writing a booking. After
the caller consents, the voice-facing `create_inspection_request` needs only the
confirmation flag; the bridge fills the original backend tool's full arguments.
The MCP server inventory remains six tools, while the bridge exposes seven voice
functions when writes are enabled. Deploy `bridge.mjs`, `trade-tools.mjs` and
`trade-action-policy.mjs` together for this flow (`Conversation flow v11`).

### Existing service or advice

`create_inspection_request` accepts `requestType=existing_service` with an active
`serviceId` and `customRequest=null`, or `requestType=custom_quote` with
`serviceId=null` and `customRequest={title,description}`. Scope/title is 3-120
characters; description is optional and limited to 1500 characters, matching the
portal. Both paths require contacts, site details, one to three preferred sessions,
live availability checks, preparation, final consent and duplicate protection.
An advice request never invents a service ID. With Sophie booking authority and
staff automation enabled, it may confirm an available inspector whose existing
Team permission allows receiving and handling quotation requests
(`canget_qutaion=true`). Normal working hours, off days, leave, closures, existing
work and travel buffers apply. This confirms an assessment visit, not a work price
or quotation. No eligible inspector leaves the request pending. The same shared
assignment workflow applies to new voice and customer-portal advice requests.

Deploy/restart Trade first so MCP advertises these new fields, then upload
`bridge.mjs`, `trade-tools.mjs` and `trade-action-policy.mjs` together and restart
the existing bridge. No new environment settings or tools on Command Center are
needed. Older bridge callers that omit `requestType` still default to an existing
service request.

### Automatic inspection confirmation

The existing `create_inspection_request` tool can select one of the caller's
preferred sessions and assign a qualified, available inspector in the same domain
workflow; a second tool call is not required. Trade must have
`AI_AUTO_ASSIGN_STAFF_ENABLED=true`, and the business owner must enable
**Settings > Sophie booking authority > Allow Sophie to assign staff and confirm
bookings**, then save. This is a Trade setting, not a bridge env flag.

Staff must be active, eligible for the service (or permitted to handle quotation
requests for an advice inspection), have working-day availability,
and have no conflicting leave or work (including configured travel buffers).
The planner tries the supplied preferences in order. No eligible match leaves
the request pending. Only a saved scheduled request with an inspector and exact
visit time returns `CONFIRMED`; its public appointment includes the inspector's
display name, not private email or staff ID. Incomplete scheduled results return
`UNKNOWN` for staff verification. Sophie must announce only the returned result.

Trade exposes these read tools at POST `/api/ai/mcp`:

- `get_business_profile`
- `list_services`
- `find_customer` — exact caller-provided email and phone; returns a business-scoped reference only.
- `get_available_slots` — live unavailable morning/afternoon sessions across 1–90 days.

With `AI_VOICE_ACTIONS_ENABLED=true`, Trade also exposes:

- `register_customer` — requires explicit account-creation consent after contact readback. Existing profiles remain unchanged; new accounts receive the normal activation email asynchronously.
- `create_inspection_request` — requires full readback, confirmation and live slot validation; accepts an active business service or an advice scope of work. A customer account is optional; guests can submit requests.

The bridge calls these tools directly in Trade. It requires services and availability
to be read during the call, binds customer references to the supplied contacts,
and generates private retry keys. Durable claims in `ai_voice_submissions` prevent
repeated submissions with the same key. Saved or uncertain actions cannot be
submitted again during that call; an `UNKNOWN` outcome needs staff verification.

Requests normally return `PENDING_REVIEW`, which is not a confirmed appointment.
Automatic confirmation requires the existing `AI_AUTO_ASSIGN_STAFF_ENABLED=true`,
the business's `sophieBookingAuthority=true`, and successful staff assignment.
Only an actual scheduled result returns `CONFIRMED`. Matching contact details does
not authenticate the caller; history, profile editing, cancellations, rescheduling,
standalone messaging and transfers remain unavailable.

For every non-onboarding call the bridge first posts the DID to Trade's
authenticated `/api/ai/voice` discovery endpoint. An active dashboard mapping
returns the Trade business ID, which is pinned before the MCP session starts.
Disabled numbers or inactive businesses return 403 and cannot fall back to
Command Center. Reassignment invalidates an old call's business binding.

An unmapped number returns `{matched:false,did}`. The bridge then uses existing
Command Center routing for Black/Pink. Discovery outages may still use a verified
Black/Pink route, but never Command Center's Trade tools. Onboarding keeps its
separate route and credential.

## Manage numbers

Super admins manage `/dashboard/did-mappings`: add, reassign, enable or disable
a number. `ai_did_mappings` is the sole runtime assignment source. Numbers no
longer need an environment mapping or a list on the bridge. Phone provisioning
and the Yeastar route to extension 2000 are still required.

Pilot `0359111403` has been migrated into dashboard storage for Nira Electrical
Lynbrook, business document `egr6Q6c19rgjJgUuzAI9`. Its local environment mapping
and the local bridge DID list have been removed. Other installations can migrate
their old setup mappings before removing them:

```powershell
npx tsx --import ./scripts/stub-server-only.mjs --env-file=.env --env-file=.env.local scripts/migrate-voice-did-mappings.ts
```

The migration preserves any existing dashboard record, including disabled ones.
Old setup entries can also be edited and saved from the dashboard. They show
Needs saving until persisted and cannot route calls from the environment alone.

## Private settings

Trade only needs its existing credentials and feature flag:

```dotenv
AI_VOICE_DIRECT_ENABLED=true
AI_VOICE_BRIDGE_SECRET=<dedicated Trade secret>
# Enable after uploading the updated bridge modules below:
AI_VOICE_ACTIONS_ENABLED=true
```

The bridge's `.env.trade-direct-pilot` needs:

```dotenv
BMSPRO_TRADE_MCP_URL=http://127.0.0.1:13001/api/ai/mcp
BMSPRO_TRADE_BRIDGE_SECRET=<same dedicated Trade secret>
BMSPRO_ALLOW_HTTP_FOR_LOCAL_TEST=true
```

There is no `BMSPRO_TRADE_DIRECT_DIDS_JSON`. Keep the existing main `.env` for
the other products, OpenAI and telemetry. Load both files when starting.
Never print or commit either secret. Production should use Trade's HTTPS URL.

## Deploy to the existing server

In SSH, back up the two clients:

```bash
cd ~/bmspro-voice-bridge
cp tenant-routing.mjs tenant-routing.before-discovery.mjs
cp trade-tools.mjs trade-tools.before-actions.mjs
```

Upload from local PowerShell:

```powershell
$bridgeDir = 'C:\Users\Niranga Lakshan\Documents\New project\output\bmspro-voice-bridge'
scp "$bridgeDir\tenant-routing.mjs" "$bridgeDir\trade-tools.mjs" "$bridgeDir\trade-action-policy.mjs" dev@100.88.220.83:/home/dev/bmspro-voice-bridge/
```

For an existing dashboard-routing installation, only `trade-tools.mjs` and
`trade-action-policy.mjs` are new. Upload both together before enabling writes.
Set `AI_VOICE_ACTIONS_ENABLED=true` in Trade's `.env.local` (restart Next.js) or
hosting environment (redeploy). No new voice bridge environment setting is needed.
The old `AI_VOICE_TRADE_REQUESTS_ENABLED` flag does not enable these tools.

In SSH remove the old DID list and run the read-only readiness check:

```bash
sed -i '/^BMSPRO_TRADE_DIRECT_DIDS_JSON=/d' .env .env.trade-direct-pilot
node --env-file=.env --env-file=.env.trade-direct-pilot check-mcp.mjs 0359111403
```

Expected: Trade business verified, active services loaded, and seven voice functions when
actions are enabled (four when disabled). The check does not call OpenAI,
register customers, create a booking or send messages.
After readiness succeeds, stop the existing manually running bridge with Ctrl+C
and restart it:

```bash
node --env-file=.env --env-file=.env.trade-direct-pilot bridge.mjs
```

Do not start a competing process if the bridge is service-managed. Restart its
existing service with both environment files instead.

Keep Trade running on the Windows PC at port 3001 and keep the existing SSH
reverse tunnel running in another local PowerShell terminal:

```powershell
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -R 127.0.0.1:13001:127.0.0.1:3001 dev@100.88.220.83
```

Deploy the server-only mapping rules when deploying Trade:

```powershell
npx firebase deploy --only firestore:rules --project bmspro-trade
```

Submission ledgers remain protected by the existing Admin SDK-only rules.

## Verification

Trade: `npm run test:ai-voice-bridge`.
Bridge: `node --test trade.test.mjs trade-action-policy.test.mjs direct-trade.test.mjs onboarding.test.mjs pink.test.mjs startup.test.mjs`.
The tests cover dashboard discovery, disabled/unmapped numbers, credential
boundaries, stale business bindings, consent, scoped customer references, live slot
validation, pending/confirmed results, account preservation and duplicate prevention.
Offline tests use in-memory boundaries and never create real accounts or bookings.
