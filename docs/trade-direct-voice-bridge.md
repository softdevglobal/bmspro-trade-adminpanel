# Trade voice bridge: dashboard discovery and read-only MCP

## Current behavior

Trade exposes exactly two MCP tools at POST `/api/ai/mcp`:

- `get_business_profile`
- `list_services`

Availability, inspection submission, customer writes, messaging and transfers
are not exposed by Trade's direct MCP or its updated bridge client. The previous
write flag cannot enable them. Normal Trade booking APIs remain unchanged.

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
cp trade-tools.mjs trade-tools.before-readonly.mjs
```

Upload from local PowerShell:

```powershell
$bridgeDir = 'C:\Users\Niranga Lakshan\Documents\New project\output\bmspro-voice-bridge'
scp "$bridgeDir\tenant-routing.mjs" "$bridgeDir\trade-tools.mjs" dev@100.88.220.83:/home/dev/bmspro-voice-bridge/
```

In SSH remove the old DID list and run the read-only check:

```bash
sed -i '/^BMSPRO_TRADE_DIRECT_DIDS_JSON=/d' .env .env.trade-direct-pilot
node --env-file=.env --env-file=.env.trade-direct-pilot check-mcp.mjs 0359111403
```

Expected: Trade business verified, one active service, and exactly the two read
tools. The check does not call OpenAI, create a booking or send messages.
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

Historical submission ledgers remain protected; no saved inspection data is
deleted by removing the direct booking tool.

## Verification

Trade: `npm run test:ai-voice-bridge`.
Bridge: `node --test trade.test.mjs direct-trade.test.mjs onboarding.test.mjs pink.test.mjs startup.test.mjs`.
The tests cover dashboard discovery, disabled/unmapped numbers, credential
boundaries, stale business bindings and rejection of removed tools.
