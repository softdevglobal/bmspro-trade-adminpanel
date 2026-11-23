/**
 * Voice page control, browser tool: Sophie opens a Trade page by name, scrolls it, or presses its
 * Refresh button, like the owner would. Read only: it never changes data, so it needs no yes.
 *
 *   control_page   open (page), scroll_down, scroll_up, top, bottom, refresh
 *
 * Offered in browser mode whenever any browser tool area is on. Pure apart from the DOM: no
 * server-only imports, so the session route and the voice session share it.
 */
import type { VoiceResult } from "./owner-team";

export const CONTROL_PAGE_TOOL = "control_page";
export const PAGE_ACTIONS = ["open", "scroll_down", "scroll_up", "top", "bottom", "refresh"] as const;
export type PageAction = (typeof PAGE_ACTIONS)[number];

/** Owner pages Sophie may open, by the name the owner hears in the sidebar. */
export const OWNER_PAGES = {
  today: "/dashboard",
  calendar: "/dashboard/calendar",
  site_inspections: "/dashboard/requests",
  quotations: "/dashboard/quotations",
  jobs: "/dashboard/jobs",
  invoices: "/dashboard/invoices",
  emails: "/dashboard/emails",
  services: "/dashboard/services",
  team_management: "/dashboard/team/management",
  attendance: "/dashboard/team/attendance",
  leave_requests: "/dashboard/team/leave-requests",
  customers: "/dashboard/customers",
  item_list: "/dashboard/items",
  ai_knowledge: "/dashboard/ai/knowledge",
  calls: "/dashboard/call-recordings",
  sms: "/dashboard/sms",
  sms_credits: "/dashboard/sms",
  sms_log: "/dashboard/sms/log",
  custom_messages: "/dashboard/sms/custom-messages",
  subscription: "/dashboard/subscription",
  settings: "/dashboard/settings",
} as const;
export type OwnerPageName = keyof typeof OWNER_PAGES;
const PAGE_NAMES = Object.keys(OWNER_PAGES) as OwnerPageName[];

export function ownerPageSessionTools() {
  return [
    {
      type: "function", name: CONTROL_PAGE_TOOL,
      description:
        "Move around Trade on the owner's screen. open goes to page (e.g. item_list, attendance, leave_requests, team_management, services). " +
        "scroll_down, scroll_up, top and bottom scroll the current page (inside an open popup use that popup's form tool instead). " +
        "refresh presses the page's Refresh button to reload its list. Read only: it changes no records. Use it when the owner asks to go to, " +
        "show, scroll or refresh a page; use the area's own tools to add, edit, delete or read records.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: PAGE_ACTIONS },
          page: { type: "string", enum: PAGE_NAMES },
        },
        required: ["action"], additionalProperties: false,
      },
    },
  ] as const;
}

/** The element that scrolls the page: the nearest scrollable ancestor of <main>, else the window. */
/** The element that scrolls the current page: the nearest scrollable ancestor of <main>. Shared with owner-sms.ts. */
export function scrollTarget(): HTMLElement {
  let node: HTMLElement | null = document.querySelector("main");
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** A visible Refresh button on the page itself (not in a popup or the Sophie panel). */
function refreshButton(): HTMLButtonElement | null {
  const main = document.querySelector("main");
  if (!main) return null;
  const buttons = [...main.querySelectorAll<HTMLButtonElement>("button")];
  return buttons.find((button) =>
    !button.disabled && button.offsetParent !== null &&
    /^\s*refresh\s*$/i.test(button.textContent ?? "") &&
    !button.closest("[role='dialog']")) ?? null;
}

export type PageRunContext = { goTo: (path: string) => void; currentPath: () => string };

export async function runControlPageTool(rawArguments: string, context: PageRunContext): Promise<VoiceResult> {
  let args: { action?: unknown; page?: unknown } = {};
  try { args = JSON.parse(rawArguments || "{}"); } catch { return { status: "REJECTED", message: "Send valid arguments." }; }
  const action = typeof args.action === "string" ? args.action : "";
  if (!(PAGE_ACTIONS as readonly string[]).includes(action)) {
    return { status: "REJECTED", message: `action must be one of: ${PAGE_ACTIONS.join(", ")}.` };
  }

  if (action === "open") {
    const page = typeof args.page === "string" ? args.page : "";
    if (!(PAGE_NAMES as string[]).includes(page)) {
      return { status: "REJECTED", pages: PAGE_NAMES, message: "Ask which page, then send one of these page names." };
    }
    const path = OWNER_PAGES[page as OwnerPageName];
    if (context.currentPath() === path) return { status: "OK", message: `The ${page.replace(/_/g, " ")} page is already open.` };
    context.goTo(path);
    return { status: "OPENED", message: `The ${page.replace(/_/g, " ")} page is opening.` };
  }

  if (action === "refresh") {
    const button = refreshButton();
    if (!button) return { status: "NO_REFRESH", message: "This page has no Refresh button. Its data is already current." };
    button.click();
    return { status: "OK", message: "Pressed Refresh. The list is reloading." };
  }

  const target = scrollTarget();
  const viewport = target === document.documentElement || target === document.scrollingElement ? window.innerHeight : target.clientHeight;
  const atTop = target.scrollTop <= 4;
  const atBottom = target.scrollTop + viewport >= target.scrollHeight - 4;
  if (action === "top" || action === "bottom") {
    target.scrollTo({ top: action === "top" ? 0 : target.scrollHeight, behavior: "smooth" });
    return { status: "OK", message: action === "top" ? "At the top of the page." : "At the bottom of the page." };
  }
  const down = action === "scroll_down";
  if (down ? atBottom : atTop) return { status: "OK", message: down ? "Already at the bottom of the page." : "Already at the top of the page." };
  target.scrollBy({ top: (down ? 1 : -1) * Math.round(viewport * 0.8), behavior: "smooth" });
  return { status: "OK", message: down ? "Scrolled down." : "Scrolled up." };
}
