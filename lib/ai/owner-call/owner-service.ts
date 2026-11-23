/**
 * Voice service creation: the owner asks Sophie (Talk to Sophie) to add a service.
 * Runs as owner MCP tools on the server (lib/ai/mcp/tools/owner-service.tools.ts).
 *
 *   prepare_service  stores a pending draft for this owner. Creates nothing.
 *   create_service   creates the live service from the STORED draft after the owner says yes.
 *
 * Pure: no server-only imports, so both routes and the tests share these rules.
 */


import { z } from "zod"; // validation library already used across the project
import { ownerDeclined } from "./voice-draft"; // same yes/no reading as voice knowledge drafts

/** Browser event fired after Sophie creates a service, so an open Services page reloads its list. */
export const SERVICES_CHANGED_EVENT = "trade:services-changed";

// Limits for one spoken service. Same ranges as the Services wizard.
export const OWNER_SERVICE_LIMITS = {
  nameMin: 2, // shortest service name
  nameMax: 120, // longest service name
  minMinutes: 15, // shortest job
  maxMinutes: 720, // longest job (12 hours)
  maxTasks: 12, // most checklist steps
  taskTitleMax: 120, // step title length
  taskDescriptionMax: 500, // step description length
  reviewMs: 5_000, // owner needs at least 5 s to hear the read-back before create
  draftTtlMs: 30 * 60_000, // a draft older than 30 min must be prepared again
  createsPerHour: 10, // services created by voice per owner per hour
} as const;
const L = OWNER_SERVICE_LIMITS; // short alias for the lines below

// The two tool names. The bridge allow-list must contain exactly these.
export const OWNER_SERVICE_TOOL_NAMES = ["prepare_service", "create_service"] as const;


// Arguments for prepare_service, as a zod shape (the MCP server needs a shape, not an object)
export const prepareServiceArgs = {
  name: z.string().trim().min(L.nameMin).max(L.nameMax), // service name
  durationMin: z.number().int().min(L.minMinutes).max(L.maxMinutes), // typical job length
  tasks: z.array(z.object({
    title: z.string().trim().min(1).max(L.taskTitleMax), // step title, required
    description: z.string().trim().max(L.taskDescriptionMax).optional(), // step detail, optional by voice
  }).strict()).min(1).max(L.maxTasks), // 1 to 12 steps
};
export const prepareServiceInput = z.object(prepareServiceArgs).strict(); // full validator, no extra fields
export type PrepareServiceInput = z.infer<typeof prepareServiceInput>; // TypeScript type of a valid draft

// Arguments for create_service
export const createServiceArgs = {
  confirmed: z.boolean(), // the model says the owner clearly said yes
};

// Feature flag, off unless set. Separate from the knowledge flags so it can be switched off alone.
export function ownerServiceEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.AI_OWNER_VOICE_SERVICE_ENABLED === "true";
}


// Added to Sophie's instructions. Short: the bridge caps all instructions at 4,000 characters.
// Kept very short: with every flag on the whole prompt sits just under the bridge's 4,000-character cap.
// The detailed rules live in the tool descriptions in lib/ai/owner-call/tools.ts, which have no such cap.
export const OWNER_SERVICE_INSTRUCTIONS =
  "To add, edit or delete a service, call open_add_service_form, open_edit_service_form or delete_service.";

/** Browser tool (runs in components/owner-voice-session.tsx): opens the Add service popup on the Services page. */
export const OPEN_ADD_SERVICE_TOOL_NAME = "open_add_service_form";
export const SERVICES_PAGE = "/dashboard/services";
/** Fired so a mounted Services page opens its Add service popup. */
export const OPEN_ADD_SERVICE_EVENT = "trade:open-add-service";

let pendingOpenAddService = false; // survives the page navigation, because the page may mount after the request

/** Asks the Services page to open its Add service popup (now if mounted, otherwise when it mounts). */
export function requestOpenAddService() {
  pendingOpenAddService = true;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_ADD_SERVICE_EVENT));
}

/** Returns true once per request, so the popup opens a single time. */
export function consumeOpenAddService() {
  const pending = pendingOpenAddService;
  pendingOpenAddService = false;
  return pending;
}

export const CHOOSE_SERVICE_SOURCE_TOOL_NAME = "choose_service_source";

export type ServiceSourceArgs = { source: "template" | "custom"; templateName?: string };
export type ServiceSourceResult = { status: string; message: string; templates?: string[] };
type ServiceSourceHandler = (args: ServiceSourceArgs) => ServiceSourceResult;
let serviceSourceHandler: ServiceSourceHandler | null = null; // set by the open Add service popup

/** The Add service popup registers itself here while open. Returns an unregister function. */
export function registerServiceSourceHandler(handler: ServiceSourceHandler) {
  serviceSourceHandler = handler;
  return () => { if (serviceSourceHandler === handler) serviceSourceHandler = null; };
}

/** Applies the owner's spoken choice (existing template or custom) to the open popup. */
export function chooseServiceSource(args: ServiceSourceArgs): ServiceSourceResult {
  if (!serviceSourceHandler) {
    return { status: "NO_FORM", message: "The Add service popup is not open. Call open_add_service_form first." };
  }
  return serviceSourceHandler(args);
}

export const SERVICE_FORM_STEP_TOOL_NAME = "service_form_step";

/** Every action Sophie can take in the open Add / Edit service popup. */
export const SERVICE_FORM_ACTIONS = [
  "fill", "continue", "back", "save", "scroll_down", "scroll_up", "show",
  "add_task", "edit_task", "remove_task", "move_task",
] as const;
/** Parts of the details step Sophie can scroll to with action show. */
export const SERVICE_FORM_SECTIONS = ["photo", "name", "duration", "tasks", "live"] as const;

export type ServiceFormStepArgs = {
  action: (typeof SERVICE_FORM_ACTIONS)[number];
  name?: string;
  durationMin?: number;
  /** true = Live in catalog, false = Paused. */
  isActive?: boolean;
  tasks?: { title: string; description?: string }[];
  /** One job step, numbered from 1 as shown on screen (edit_task, remove_task, move_task). */
  taskNumber?: number;
  /** Where move_task moves it, or where add_task inserts (from 1; default the end). */
  toNumber?: number;
  /** Step text for add_task / edit_task. */
  title?: string;
  description?: string;
  section?: (typeof SERVICE_FORM_SECTIONS)[number];
};
type ServiceStepHandler = (args: ServiceFormStepArgs) => ServiceSourceResult | Promise<ServiceSourceResult>;
let serviceStepHandler: ServiceStepHandler | null = null; // set by the open Add service popup

/** The Add service popup registers itself here while open. Returns an unregister function. */
export function registerServiceStepHandler(handler: ServiceStepHandler) {
  serviceStepHandler = handler;
  return () => { if (serviceStepHandler === handler) serviceStepHandler = null; };
}

/** Fills fields, then presses Continue, Back or Save in the open popup. */
export async function runServiceFormStep(args: ServiceFormStepArgs): Promise<ServiceSourceResult> {
  if (!serviceStepHandler) {
    return { status: "NO_FORM", message: "No service popup is open. Call open_add_service_form or open_edit_service_form first." };
  }
  return serviceStepHandler(args);
}

/** Browser tools: open an existing service in the Edit popup, and delete one through the page's own confirm dialog. */
export const OPEN_EDIT_SERVICE_TOOL_NAME = "open_edit_service_form";
export const DELETE_SERVICE_TOOL_NAME = "delete_service";
/** Browser tool, read only: the owner's services, loaded through the same API as the Services page. */
export const LIST_SERVICES_TOOL_NAME = "list_services";
/** Most services read out in one result, so a large catalogue stays short. */
export const LIST_SERVICES_MAX = 50;

/** One service as Sophie sees it in list_services. */
export type SpokenService = { name: string; durationMin: number; live: boolean; steps: number };

/** Shapes GET /api/services rows for Sophie: name, duration, live or not and step count only. */
export function summarizeServices(
  services: { name: string; defaultDurationMin: number; isActive: boolean; tasks?: unknown[] }[],
) {
  const rows: SpokenService[] = services.map((service) => ({
    name: service.name, durationMin: service.defaultDurationMin, live: service.isActive, steps: service.tasks?.length ?? 0,
  }));
  return {
    status: rows.length ? "OK" : "NO_SERVICES",
    total: rows.length,
    live: rows.filter((row) => row.live).length,
    services: rows.slice(0, LIST_SERVICES_MAX),
    complete: rows.length <= LIST_SERVICES_MAX,
    message: rows.length
      ? "Read out the names, or the count if the owner only asked how many. If complete is false, say only the first ones are listed."
      : "This business has no services yet. Offer to add one.",
  };
}

/** What the Services page lets Sophie do, like the owner using a service card's Edit and Delete buttons. */
export type ServicesPageVoice = {
  openEdit(serviceName: string): ServiceSourceResult;
  prepareDelete(serviceName: string): ServiceSourceResult;
  confirmDelete(): Promise<ServiceSourceResult>;
  cancelDelete(): ServiceSourceResult;
};
let servicesPageVoice: ServicesPageVoice | null = null; // set while the Services page is open with its list loaded

/** The Services page registers itself here once its list has loaded. Returns an unregister function. */
export function registerServicesPageVoice(handler: ServicesPageVoice) {
  servicesPageVoice = handler;
  return () => { if (servicesPageVoice === handler) servicesPageVoice = null; };
}

/** Runs once the Services page is ready, waiting briefly because Sophie may have just navigated there. */
export async function withServicesPage(
  run: (page: ServicesPageVoice) => ServiceSourceResult | Promise<ServiceSourceResult>,
  timeoutMs = 8_000,
): Promise<ServiceSourceResult> {
  const until = Date.now() + timeoutMs;
  while (!servicesPageVoice && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100));
  if (!servicesPageVoice) {
    return { status: "NO_PAGE", message: "The Services page did not load. Ask the owner to open Services, then try again." };
  }
  return run(servicesPageVoice);
}

/** Finds one service by the name the owner said: an exact match (any case), else the only partial match. */
export function matchServiceByName<T extends { name: string }>(
  services: T[], spoken: string,
): { ok: true; service: T } | { ok: false; result: ServiceSourceResult } {
  const wanted = spoken.trim().toLowerCase();
  const exact = services.find((service) => service.name.trim().toLowerCase() === wanted);
  if (wanted && exact) return { ok: true, service: exact };
  const partial = wanted
    ? services.filter((service) => {
      const name = service.name.trim().toLowerCase();
      return name.includes(wanted) || wanted.includes(name);
    })
    : [];
  if (partial.length === 1) return { ok: true, service: partial[0] };
  if (partial.length > 1) {
    return { ok: false, result: {
      status: "AMBIGUOUS", templates: partial.map((service) => service.name).slice(0, 20),
      message: "Several services match. Read out these names and ask which one.",
    } };
  }
  return { ok: false, result: {
    status: "NO_MATCH", templates: services.map((service) => service.name).slice(0, 20),
    message: services.length
      ? "No service has that name. Read out these service names and ask which one."
      : "This business has no services yet.",
  } };
}

/** Realtime tool definitions (JSON Schema) that run in the owner's browser. Offered with the service tools. */
export function openAddServiceSessionTools() {
  return [
    {
      type: "function",
      name: OPEN_ADD_SERVICE_TOOL_NAME,
      description:
        "Go to the Services page and open the Add service popup on the owner's screen. Use it as soon as the owner asks to add or create a service. " +
        "Then ask exactly one question: Do you want to create it from one of the existing templates shown, or as a custom service? " +
        "Only if the owner dictates the details instead, use prepare_service, read it back, and create_service after a clear yes.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: CHOOSE_SERVICE_SOURCE_TOOL_NAME,
      description:
        "Apply the owner's answer in the open Add service popup. source is template (an existing template shown) or custom. " +
        "For template, pass templateName if they named one; otherwise read out the names returned and ask which one. " +
        "Custom opens the details step. Then carry on with service_form_step.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["template", "custom"] },
          templateName: { type: "string", description: "Name of the existing template the owner chose" },
        },
        required: ["source"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: SERVICE_FORM_STEP_TOOL_NAME,
      description:
        "Drive the open Add service or Edit service popup on screen, like the owner using its fields and buttons. Use it whenever the owner tells you service details " +
        "or says to fill, change, continue or save. fill types name, durationMin (15-720 minutes), isActive (true Live, false Paused) and tasks " +
        "(replaces the whole step list; for one step use the task actions). add_task adds one step (title, optional description, optional toNumber position); " +
        "edit_task changes step taskNumber (title and/or description); remove_task removes step taskNumber; move_task moves step taskNumber to toNumber. " +
        "Steps are numbered from 1 as on screen; each task result lists them. show scrolls to a section (photo, name, duration, tasks, live) when you talk about it; " +
        "scroll_down and scroll_up move the popup when the owner asks to scroll. Changes scroll the screen to what changed. " +
        "continue goes to the next step, back to the previous one; save stores the service (only on the review step, only after you read the name, duration and steps back " +
        "and the owner clearly said yes). A photo can only be uploaded by the owner. Ask one short question at a time for anything missing. " +
        "If the result is INVALID, tell the owner why and ask for the fix. Never state prices.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: SERVICE_FORM_ACTIONS },
          name: { type: "string", description: "Service name" },
          durationMin: { type: "integer", minimum: L.minMinutes, maximum: L.maxMinutes },
          isActive: { type: "boolean", description: "true = Live in catalog, false = Paused" },
          taskNumber: { type: "integer", minimum: 1, maximum: L.maxTasks, description: "Step number as shown on screen" },
          toNumber: { type: "integer", minimum: 1, maximum: L.maxTasks, description: "New position for move_task or add_task" },
          title: { type: "string", description: "Step title for add_task or edit_task" },
          description: { type: "string", description: "Step detail for add_task or edit_task" },
          section: { type: "string", enum: SERVICE_FORM_SECTIONS, description: "Section to scroll to for show" },
          tasks: {
            type: "array", maxItems: L.maxTasks, description: "Ordered job steps; replaces the current list",
            items: {
              type: "object",
              properties: { title: { type: "string" }, description: { type: "string" } },
              required: ["title"], additionalProperties: false,
            },
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: LIST_SERVICES_TOOL_NAME,
      description:
        "List the business's services: name, duration in minutes, whether each is live, and how many job steps it has, plus totals. Read only. " +
        "Use it when the owner asks what services they have or how many, or names a service you need to find before editing or deleting it.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: OPEN_EDIT_SERVICE_TOOL_NAME,
      description:
        "Go to the Services page and open the Edit service popup for the service the owner names. Use it when the owner asks to change, edit or update a service. " +
        "On NO_MATCH or AMBIGUOUS read out the names returned and ask which one. Once it is open, ask what to change, then use service_form_step: " +
        "fill with only the changed fields (tasks replaces the whole step list, so send every step), continue to the review step, read it back, and save only after a clear yes.",
      parameters: {
        type: "object",
        properties: { serviceName: { type: "string", description: "Name of the service as the owner said it" } },
        required: ["serviceName"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: DELETE_SERVICE_TOOL_NAME,
      description:
        "Delete one of the owner's services. action prepare shows the delete confirmation on screen for serviceName and deletes nothing; " +
        "then ask exactly: Should I delete <name>? This cannot be undone. Use action confirm only after the owner clearly says yes, and cancel if they say no or hesitate. " +
        "On NO_MATCH or AMBIGUOUS read out the names returned and ask which one. The owner can also press the buttons on screen.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["prepare", "confirm", "cancel"] },
          serviceName: { type: "string", description: "Name of the service to delete; needed for prepare" },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  ] as const;
}



// JSON Schema sent to the realtime model for each tool (the model does not read zod)
export const OWNER_SERVICE_PARAMETERS = {
  prepare_service: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short service name, e.g. 'Gutter cleaning'" },
      durationMin: { type: "integer", minimum: L.minMinutes, maximum: L.maxMinutes, description: "Typical job length in minutes" },
      tasks: {
        type: "array", minItems: 1, maxItems: L.maxTasks, description: "Ordered job steps",
        items: {
          type: "object",
          properties: { title: { type: "string" }, description: { type: "string" } },
          required: ["title"], additionalProperties: false,
        },
      },
    },
    required: ["name", "durationMin", "tasks"], additionalProperties: false,
  },
  create_service: {
    type: "object",
    properties: { confirmed: { type: "boolean", description: "true only when the owner clearly said yes to the read-back" } },
    required: ["confirmed"], additionalProperties: false,
  },
} as const;

// Result of the "may we create?" check
export type CreateDecision =
  | { ok: true }
  | { ok: false; status: "NO_DRAFT" | "EXPIRED" | "NOT_CONFIRMED"; message: string };

// Decides whether create_service may run. Pure, so every rule is unit tested.
export function checkCreate(draft: { createdAt: number } | null, confirmed: unknown, now: number): CreateDecision {
  if (!draft) return { ok: false, status: "NO_DRAFT", message: "Nothing is prepared. Call prepare_service first." }; // no draft stored
  if (now - draft.createdAt > L.draftTtlMs) return { ok: false, status: "EXPIRED", message: "That draft is too old. Prepare it again and read it back." }; // stale
  if (confirmed !== true) return { ok: false, status: "NOT_CONFIRMED", message: "Read it back and ask. Create only after a clear yes." }; // model didn't confirm
  if (now - draft.createdAt < L.reviewMs) return { ok: false, status: "NOT_CONFIRMED", message: "Read the service back to the owner and wait for their answer first." }; // too fast to have heard a reply
  return { ok: true }; // all checks passed
}

/**
 * What the browser knows about the owner's reply since prepare_service succeeded.
 * The server never hears the owner; the voice session does (owner-voice-session.tsx).
 */
export type OwnerReplyCheck = {
  prepared: boolean; // prepare_service returned READY_TO_CONFIRM in this session
  ownerTurnsSinceShown: number; // times the owner spoke or typed since then
  latestOwnerReply: string | null; // transcript of that reply, if transcription worked
};

/**
 * Browser-side gate for create_service, checked before the call reaches the server.
 * Same rules as save_knowledge_draft: the owner must have replied after the read-back,
 * and a "no / wait / cancel" without a leading yes blocks it.
 */
export function checkOwnerReply(s: OwnerReplyCheck): CreateDecision {
  if (!s.prepared) return { ok: false, status: "NO_DRAFT", message: "Nothing is prepared in this session. Call prepare_service first." }; // no draft this session
  if (s.ownerTurnsSinceShown < 1) return { ok: false, status: "NOT_CONFIRMED", message: "Read the service back and wait for the owner to answer before creating it." }; // owner hasn't replied
  if (ownerDeclined(s.latestOwnerReply)) return { ok: false, status: "NOT_CONFIRMED", message: "The owner did not clearly say yes. Ask whether to change it, add it, or leave it." }; // owner said no/wait
  return { ok: true }; // owner replied and did not decline
}











