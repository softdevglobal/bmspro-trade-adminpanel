# Services module (`lib/onboarding/services/`)

This folder contains everything for the **Services** feature, kept separate from core onboarding (`types.ts`, `server.ts`, etc.).

## Folder layout

| File | Purpose |
|------|---------|
| `collections.ts` | Firestore collection names + document field shapes (schema reference) |
| `types.ts` | API input validation and TypeScript types for requests |
| `display.ts` | Client-safe types returned to the UI (JSON-friendly) |
| `server.ts` | Server-only CRUD — reads/writes Firestore via Admin SDK |
| `upload.ts` | Image upload to Firebase Storage |

## Firestore collections

Tasks are stored **inside** the parent document as a `tasks` array — not in separate collections.

```
service_templates/{id}
  ├── name, businessType, category, ...
  └── tasks: [{ id, title, description, isRequired, ... }, ...]

services/{id}
  ├── businessId, templateId, name, ...
  └── tasks: [{ id, title, description, isRequired, ... }, ...]

businesses/{id}   (existing onboarding — read businessType only)
```

### Example document

```json
{
  "id": "abc123",
  "businessId": "biz456",
  "name": "Blocked drain clearance",
  "category": "Plumbing",
  "requiredSkill": "Plumbing",
  "defaultDurationMin": 60,
  "needsReview": false,
  "isActive": true,
  "imageUrl": null,
  "tasks": [
    {
      "id": "task-uuid-1",
      "title": "Inspect drain",
      "description": "Check blockage location",
      "isRequired": true,
      "photoRequired": true,
      "customerVisible": true,
      "sortOrder": 0
    }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

### Example: creating a business service

When POST `/api/services` is called:

1. **API route** checks auth and calls `createBusinessService()`.
2. **server.ts** validates input, optionally merges a template.
3. **One document write** to `services/{newId}` including the `tasks` array.
4. No separate task documents are created.

### Legacy data

Older records may still have tasks in `service_tasks` or `service_template_tasks` subcollections. `server.ts` falls back to those when `tasks[]` is missing on the parent document. Re-saving a service or template migrates it to the embedded format.

### Images

Images go to **Firebase Storage** via `upload.ts`. Only the HTTPS `imageUrl` string is saved on the document.

### Security

All writes go through Next.js API routes using the **Firebase Admin SDK**.

## Related UI & API

- Page: `app/dashboard/services/page.tsx`
- API: `app/api/services/`, `app/api/service-templates/`, `app/api/admin/service-templates/`, `app/api/uploads/service-image/`
