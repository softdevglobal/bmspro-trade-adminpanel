# Voice quotations

Staff on a site inspection can describe the job by voice in the mobile app. Trade
turns the recording into a quotation draft. The staff member reviews and edits it
in the normal quotation form, then saves or sends it.

## Flow

1. **Mobile:** On the quotation form, the staff member taps **Record voice note**
   and speaks for up to 10 minutes. The app records 32 kbps mono AAC, about
   2.4 MB at the 10-minute limit.
2. **Mobile → Trade:** The app sends `POST /api/quotations/voice-draft` as a
   multipart form, with `audio` and an optional `requestId`.
3. **Trade:** The server checks the caller:
   - The caller must be an owner or admin, or staff with quotation permission.
   - Staff may only use visits assigned to them.
   - The business must have the Quotations module turned on.
4. **Speech-to-text:** Trade sends the recording to the configured transcription
   API. It includes the business's service and item names as spelling hints.
5. **Draft:** A language model receives the transcript, the business's active
   services and its item list. Prices are not sent. It returns:
   - a title;
   - a customer-facing scope of work;
   - lines, each either a catalog item id or a new item name, with a quantity;
   - checks for the staff member.
6. **Safety pass** (`resolveDraft`):
   - Unknown service or item ids are dropped.
   - Catalog lines take the catalog's name, code and price.
   - Duplicates are merged.
   - Anything not in the catalog is marked **Price needed**, with a $0 rate.
7. **Mobile:** The form fills in the title, scope and line items:
   - Unpriced lines are shown in orange.
   - Saving with a $0 unpriced line asks for confirmation.
   - When the staff member prices a new item, the existing form adds it to the item list.

Nothing is saved by the voice step. The recording is not stored. The audit log
records counts only, because the transcript can contain customer details.

## Settings (Trade env)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `AI_VOICE_QUOTATION_ENABLED` | yes | off | Set to `true` to turn the feature on |
| `OPENAI_API_KEY` | yes* | | Used for both steps unless overridden |
| `AI_TRANSCRIBE_BASE_URL` | no | `https://api.openai.com/v1` | Any OpenAI-compatible speech-to-text API, for example a VoiceStudio server |
| `AI_TRANSCRIBE_API_KEY` | no | `OPENAI_API_KEY` | Key for the transcription API |
| `AI_TRANSCRIBE_MODEL` | no | `gpt-4o-transcribe` | Transcription model |
| `AI_QUOTATION_BASE_URL` | no | `https://api.openai.com/v1` | Chat completions API with JSON-schema output |
| `AI_QUOTATION_API_KEY` | no | `OPENAI_API_KEY` | Key for the drafting model |
| `AI_QUOTATION_MODEL` | no | `gpt-4.1-mini` | Drafting model |

\* Not needed if both `AI_TRANSCRIBE_API_KEY` and `AI_QUOTATION_API_KEY` are set.

### Using VoiceStudio for speech-to-text

VoiceStudio (github.com/debpalash/VoiceStudio) is a self-hosted voice app. Its
server has an OpenAI-compatible endpoint, `POST /v1/audio/transcriptions`, on
port 3900. To keep recordings off OpenAI:

```
AI_TRANSCRIBE_BASE_URL=https://<voicestudio-host>:3900/v1
AI_TRANSCRIBE_API_KEY=<OMNIVOICE_API_KEY>
AI_TRANSCRIBE_MODEL=<model name VoiceStudio expects>
```

- **Before relying on it:** check the request fields and model names against a
  running VoiceStudio server. Its docs do not list them.
- **Use HTTPS.** Do not expose the server on the open internet without a key.
- **Licence:** VoiceStudio is AGPL-3.0, and some of its models are
  non-commercial. Check the licence before production use.
- **No mobile SDK:** VoiceStudio has no SDK the app could call, so the phone
  always sends the recording to Trade.

## Limits

- The upload limit is 4 MB, so it stays under the serverless request limit.
- Up to 60 lines per draft.
- Up to 1,500 catalog items are sent to the model.
- The route can run for up to 120 seconds (`maxDuration`).

## Tests

`npm run test:ai-voice-quotation` runs offline with a fake AI service.
