# Chat API — URLs & testing guide

**Base URL (local):** `http://localhost:3000`

Every `route.ts` file in this folder includes a header comment with its full URL,
auth requirements, request body, and response format (Postman-ready).

This folder contains all chat API routes for BMS Pro Trade. There are **two chat systems**:

| System | Firestore collection | API prefix |
|--------|----------------------|------------|
| **Support chat** (queue) | `conversations` | `/api/chat/conversations/…` |
| **CC direct chat** (1:1) | `cc_direct_chats` | `/api/chat/cc-direct/…` |

The dashboard **chat widget** (`components/support-chat-widget.tsx`) uses these APIs automatically when a business owner sends a message.

---

## Base URL

**Default (local development):**

```
http://localhost:3000
```

All endpoints below use `http://localhost:3000/api/chat/…` unless you deploy elsewhere.

| Environment | Base URL |
|-------------|----------|
| **Local (default)** | `http://localhost:3000` |
| Production | `https://<your-admin-panel-domain>` |

---

## Authentication

Every request needs:

```http
Authorization: Bearer <firebase_id_token>
Content-Type: application/json
```

| Who | How to get a token |
|-----|-------------------|
| **Business owner / admin** | Log in at `/login` — the admin panel uses the Firebase client session. For Postman, use Firebase `signInWithPassword` with the owner account. |
| **Call-center agent** | `POST http://localhost:3000/api/callcenter/auth/login` |
| **Super admin** | Firebase `signInWithPassword` with a super-admin account (works on agent routes too). |

### Get owner token (Postman)

```http
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<NEXT_PUBLIC_FIREBASE_API_KEY>
Content-Type: application/json

{
  "email": "owner@yourbusiness.com",
  "password": "yourPassword",
  "returnSecureToken": true
}
```

Copy `idToken` from the response.

### Get agent token

```http
POST http://localhost:3000/api/callcenter/auth/login
Content-Type: application/json

{
  "email": "agent@callcenter.com",
  "password": "Agent@1234"
}
```

Copy `idToken` from the response.

---

## All chat URLs

### Support chat — workshop owner

| Method | URL | Body | Description |
|--------|-----|------|-------------|
| `POST` | `http://localhost:3000/api/chat/conversations/owner/messages` | `{ "message": "Hello" }` | Send message to support queue |
| `GET` | `http://localhost:3000/api/chat/conversations/owner` | — | Get current/open conversation |
| `GET` | `http://localhost:3000/api/chat/conversations/owner/{conversationId}/messages?limit=100` | — | Load message history |
| `POST` | `http://localhost:3000/api/chat/conversations/owner/{conversationId}/read` | — | Mark agent messages as read |

### Support chat — call-center agent

| Method | URL | Body | Description |
|--------|-----|------|-------------|
| `GET` | `http://localhost:3000/api/chat/conversations/agent?queueLimit=30&mineLimit=30` | — | List queue + my conversations |
| `POST` | `http://localhost:3000/api/chat/conversations/agent/{conversationId}/claim` | — | Claim a waiting thread |
| `GET` | `http://localhost:3000/api/chat/conversations/agent/{conversationId}/messages?limit=40` | — | Load messages |
| `POST` | `http://localhost:3000/api/chat/conversations/agent/{conversationId}/messages` | `{ "message": "Hi, how can I help?" }` | Agent replies |
| `POST` | `http://localhost:3000/api/chat/conversations/agent/{conversationId}/read` | — | Mark customer messages read |
| `POST` | `http://localhost:3000/api/chat/conversations/agent/{conversationId}/close` | `{ "farewellMessage"?: "…" }` | Close thread |
| `POST` | `http://localhost:3000/api/chat/conversations/agent/{conversationId}/transfer` | `{ "targetAgentUid": "…" }` | Transfer to another agent |
| `POST` | `http://localhost:3000/api/chat/conversations/agent/presence` | `{ "online": true }` | Set agent online/offline |
| `POST` | `http://localhost:3000/api/chat/conversations/agent/fcm-token` | `{ "token": "…", "platform"?: "android" }` | Register push token |

### CC direct chat — workshop / owner

| Method | URL | Body | Description |
|--------|-----|------|-------------|
| `GET` | `http://localhost:3000/api/chat/cc-direct/agents` | — | List active call-center agents |
| `GET` | `http://localhost:3000/api/chat/cc-direct/rooms?limit=50` | — | List owner's CC threads |
| `POST` | `http://localhost:3000/api/chat/cc-direct/rooms` | `{ "queue": true }` or `{ "agentUid": "…" }` | Open queue or 1:1 room |
| `GET` | `http://localhost:3000/api/chat/cc-direct/rooms/{chatId}/messages?limit=40` | — | Load messages |
| `POST` | `http://localhost:3000/api/chat/cc-direct/rooms/{chatId}/messages` | `{ "text": "Hello" }` | Send message |
| `POST` | `http://localhost:3000/api/chat/cc-direct/rooms/{chatId}/read` | — | Mark read |
| `POST` | `http://localhost:3000/api/chat/cc-direct/rooms/{chatId}/close` | — | Close session |

### CC direct chat — call-center agent

| Method | URL | Body | Description |
|--------|-----|------|-------------|
| `GET` | `http://localhost:3000/api/chat/cc-direct/agent?limit=50` | — | List assigned + queue threads |
| `GET` | `http://localhost:3000/api/chat/cc-direct/agent/workshop-owners` | — | Picker: owners agent can contact |
| `POST` | `http://localhost:3000/api/chat/cc-direct/agent/start-with-owner` | `{ "workshopOwnerUid": "…", "text"?: "…" }` | Agent starts chat with owner |
| `GET` | `http://localhost:3000/api/chat/cc-direct/agent/{chatId}` | — | Room metadata |
| `POST` | `http://localhost:3000/api/chat/cc-direct/agent/{chatId}/claim` | — | Claim pending queue chat |
| `GET` | `http://localhost:3000/api/chat/cc-direct/agent/{chatId}/messages?limit=40` | — | Load messages |
| `POST` | `http://localhost:3000/api/chat/cc-direct/agent/{chatId}/messages` | `{ "text": "Hello" }` | Agent replies |
| `POST` | `http://localhost:3000/api/chat/cc-direct/agent/{chatId}/read` | — | Mark read |
| `POST` | `http://localhost:3000/api/chat/cc-direct/agent/{chatId}/close` | — | Close session |
| `PATCH` | `http://localhost:3000/api/chat/cc-direct/agent/{chatId}/reviewed` | `{ "reviewed": true }` | Mark thread reviewed |

### Related (not in this folder)

| Method | URL | Description |
|--------|-----|-------------|
| `POST` | `http://localhost:3000/api/callcenter/auth/login` | Agent login → `idToken` |
| `POST` | `http://localhost:3000/api/callcenter/agents` | Super admin creates agent accounts |

---

## Step-by-step: owner sent a message — what to do next

This is the most common flow when testing with the **dashboard chat widget** (bottom-right blue button).

### What happens when the owner sends a message

1. Owner opens the chat widget on any dashboard page.
2. Owner types a message and sends it.
3. The widget calls:
   ```http
   POST http://localhost:3000/api/chat/conversations/owner/messages
   Authorization: Bearer <owner_id_token>

   { "message": "test for the protrade" }
   ```
4. Server creates (or reuses) a document in `conversations/{conversationId}` with `status: "waiting"`.
5. Message is stored in `conversations/{conversationId}/messages/{messageId}`.
6. Widget header shows **"Waiting for an agent"**.

---

### Step 1 — Create a call-center agent (one-time, super admin)

If you don't have an agent yet:

```http
POST http://localhost:3000/api/callcenter/agents
Authorization: Bearer <super_admin_id_token>
Content-Type: application/json

{
  "fullName": "Sarah Johnson",
  "email": "sarah.johnson@callcenter.com",
  "phone": "+61400123456",
  "password": "Agent@1234"
}
```

---

### Step 2 — Log in as the agent

```http
POST http://localhost:3000/api/callcenter/auth/login
Content-Type: application/json

{
  "email": "sarah.johnson@callcenter.com",
  "password": "Agent@1234"
}
```

Save the `idToken` — use it as `Authorization: Bearer <idToken>` below.

---

### Step 3 — Set agent online (recommended)

So the agent receives queue notifications:

```http
POST http://localhost:3000/api/chat/conversations/agent/presence
Authorization: Bearer <agent_id_token>
Content-Type: application/json

{ "online": true }
```

---

### Step 4 — View the queue

```http
GET http://localhost:3000/api/chat/conversations/agent?queueLimit=30&mineLimit=30
Authorization: Bearer <agent_id_token>
```

Response example:

```json
{
  "ok": true,
  "queue": [
    {
      "conversationId": "abc123",
      "userName": "John Smith",
      "status": "waiting",
      "lastMessage": "test for the protrade",
      "unreadForAgent": 1
    }
  ],
  "mine": []
}
```

Copy the `conversationId` from the queue item.

---

### Step 5 — Claim the conversation

```http
POST http://localhost:3000/api/chat/conversations/agent/{conversationId}/claim
Authorization: Bearer <agent_id_token>
```

This changes `status` from `waiting` → `connected` and adds a system message: *"You are connected with …"*.

The owner's widget header updates to **"You are connected with an agent"** (via Firestore listener).

---

### Step 6 — Agent reads messages

```http
GET http://localhost:3000/api/chat/conversations/agent/{conversationId}/messages?limit=40
Authorization: Bearer <agent_id_token>
```

---

### Step 7 — Agent replies

```http
POST http://localhost:3000/api/chat/conversations/agent/{conversationId}/messages
Authorization: Bearer <agent_id_token>
Content-Type: application/json

{ "message": "Hi! How can I help you today?" }
```

The owner sees the reply in the chat widget in real time.

---

### Step 8 — Close when done (optional)

```http
POST http://localhost:3000/api/chat/conversations/agent/{conversationId}/close
Authorization: Bearer <agent_id_token>
Content-Type: application/json

{ "farewellMessage": "Thanks for contacting us!" }
```

Next owner message starts a **new** `conversations/{id}` document.

---

## CC direct chat flow (alternative to queue)

If the owner opens a **direct** or **queue** CC room instead of the support queue:

| Owner action | API |
|--------------|-----|
| Join shared CC queue | `POST http://localhost:3000/api/chat/cc-direct/rooms` → `{ "queue": true }` |
| Chat with a specific agent | `POST http://localhost:3000/api/chat/cc-direct/rooms` → `{ "agentUid": "…" }` |
| Send message | `POST http://localhost:3000/api/chat/cc-direct/rooms/{chatId}/messages` |

| Agent action | API |
|--------------|-----|
| See queue + assigned | `GET http://localhost:3000/api/chat/cc-direct/agent` |
| Claim queue chat | `POST http://localhost:3000/api/chat/cc-direct/agent/{chatId}/claim` |
| Reply | `POST http://localhost:3000/api/chat/cc-direct/agent/{chatId}/messages` |

---

## Firestore collections

| Collection | Purpose |
|------------|---------|
| `conversations` | Support queue threads |
| `conversations/{id}/messages` | Support messages |
| `cc_direct_chats` | Direct CC threads |
| `cc_direct_chats/{id}/messages` | CC messages |
| `call_center_agents` | Agent presence, FCM tokens |
| `users` | Owner + agent profiles (`role: "call_center"` for agents) |

**Writes are server-only** (API routes). Clients read via Firestore `onSnapshot` for realtime UI.

---

## Dashboard widget (owner UI)

No manual API calls needed for the owner if they use the app:

| Action | What happens |
|--------|----------------|
| Open widget | Firestore listeners start for `conversations` + `cc_direct_chats` |
| Send message | `POST /api/chat/conversations/owner/messages` (or CC room if active) |
| See replies | Realtime Firestore listener on message subcollections |

Widget file: `components/support-chat-widget.tsx`  
Client lib: `lib/unifiedWorkshopChatClient.ts`

---

## Setup checklist

Before testing end-to-end:

- [ ] `npm run dev` (or deploy the app)
- [ ] Firebase env vars in `.env.local`
- [ ] Deploy Firestore rules: `npm run firebase:deploy-rules`
- [ ] Create at least one call-center agent (`POST /api/callcenter/agents`)
- [ ] Log in as business owner and send a message from the chat widget
- [ ] Log in as agent, claim from queue, reply

If realtime listeners fail in the browser console, create the Firestore composite indexes Firebase suggests (usually `conversations` and `cc_direct_chats` with `orderBy` fields).

---

## Quick reference — owner sent message → agent responds

```
Owner (widget)          Firestore                    Agent (Postman / app)
     |                       |                                |
     |-- POST owner/messages --> conversations/waiting        |
     |                       |                                |
     |                       |<-- GET /conversations/agent ---|
     |                       |                                |
     |                       |<-- POST .../claim ------------|
     |                       |    status → connected          |
     |<-- realtime update ---|                                |
     |                       |<-- POST .../messages ----------|
     |<-- sees agent reply --|                                |
```

---

## Source files in this folder

```
app/api/chat/
├── README.md                          ← this file
├── conversations/
│   ├── owner/
│   │   ├── route.ts                   GET  — current conversation
│   │   ├── messages/route.ts          POST — owner sends (queue)
│   │   └── [conversationId]/
│   │       ├── messages/route.ts      GET  — message history
│   │       └── read/route.ts          POST — mark read
│   └── agent/
│       ├── route.ts                   GET  — queue + mine
│       ├── presence/route.ts          POST — online status
│       ├── fcm-token/route.ts         POST — push token
│       └── [conversationId]/
│           ├── claim/route.ts
│           ├── messages/route.ts
│           ├── read/route.ts
│           ├── close/route.ts
│           └── transfer/route.ts
└── cc-direct/
    ├── agents/route.ts
    ├── rooms/…
    └── agent/…
```

Server logic: `lib/chat/supportChat.ts`, `lib/chat/ccDirectChat.ts`
