/**
 * Runs the voice team tools in the owner's browser (called from components/owner-voice-session.tsx).
 * Reads use the same owner APIs as the Team pages; changes go through the pages' own popups and
 * dialogs, and are held here until the owner answered the read-back without saying no.
 */
import { checkOwnerReply } from "./owner-service";
import {
  ATTENDANCE_PERIODS, ATTENDANCE_VIEWS, attendancePageVoice, DECIDE_LEAVE_TOOL, leaveApprovalVoice, leavePageVoice,
  LIST_LEAVE_TOOL, LIST_STAFF_TOOL, MANAGE_STAFF_TOOL, OPEN_STAFF_FORM_TOOL, type OwnerTeamToolName, SHOW_ATTENDANCE_TOOL,
  STAFF_FORM_ACTIONS, STAFF_FORM_STEP_TOOL, staffFormVoice, staffPageVoice, summarizeLeave, summarizeStaff,
  TEAM_ATTENDANCE_PAGE, TEAM_LEAVE_PAGE, TEAM_STAFF_PAGE, type AttendanceArgs, type StaffFormArgs, type VoiceResult,
} from "./owner-team";

/** One pending confirmation at a time: what is waiting for a yes, and the owner's replies since it was asked. */
export type TeamGate = {
  prepared: boolean;
  kind: string | null;
  turns: number;
  replyItems: Set<string>;
  latestReply: string | null;
};
export function newTeamGate(): TeamGate {
  return { prepared: false, kind: null, turns: 0, replyItems: new Set(), latestReply: null };
}

export type TeamRunContext = {
  getToken: () => Promise<string>;
  /** Navigates to a Team page unless it is already open. */
  goTo: (path: string) => void;
  gate: TeamGate;
  signal: AbortSignal;
};

/** The question is being asked now: only replies after this point count. Shared with owner-knowledge.ts. */
export function ask(gate: TeamGate, kind: string) {
  Object.assign(gate, { prepared: true, kind, turns: 0, latestReply: null });
  gate.replyItems.clear();
}
export function clear(gate: TeamGate) {
  Object.assign(gate, { prepared: false, kind: null });
}
/** null when the owner answered the question for `kind` and did not say no. */
export function blocked(gate: TeamGate, kind: (current: string) => boolean): VoiceResult | null {
  if (!gate.kind || !kind(gate.kind)) return { status: "NOTHING_TO_CONFIRM", message: "Nothing is waiting for a yes. Prepare it first." };
  const decision = checkOwnerReply({ prepared: gate.prepared, ownerTurnsSinceShown: gate.turns, latestOwnerReply: gate.latestReply });
  if (decision.ok) return null;
  return { status: "NOT_CONFIRMED", message: "Read it back, ask, and confirm only after the owner clearly says yes." };
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined);

async function getJson(path: string, context: TeamRunContext) {
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${await context.getToken()}` },
    cache: "no-store",
    signal: AbortSignal.any([context.signal, AbortSignal.timeout(15_000)]),
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  return response.ok && data ? data : null;
}

export async function runOwnerTeamTool(name: OwnerTeamToolName, rawArguments: string, context: TeamRunContext): Promise<VoiceResult> {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(rawArguments || "{}") as Record<string, unknown>; } catch { return { status: "REJECTED", message: "Send valid arguments." }; }
  const { gate } = context;

  if (name === LIST_STAFF_TOOL) {
    const data = await getJson("/api/team/staff", context);
    if (!Array.isArray(data?.staff)) return { status: "UNAVAILABLE", message: "Could not load the team." };
    return summarizeStaff(data.staff as Parameters<typeof summarizeStaff>[0],
      typeof data.staffLimit === "number" ? data.staffLimit : null);
  }

  if (name === OPEN_STAFF_FORM_TOOL) {
    context.goTo(TEAM_STAFF_PAGE);
    clear(gate);
    const staffName = text(args.staffName);
    return staffPageVoice.run((page) => (staffName ? page.openEdit(staffName) : page.openAdd()));
  }

  if (name === STAFF_FORM_STEP_TOOL) {
    const action = text(args.action);
    if (!(STAFF_FORM_ACTIONS as readonly string[]).includes(action)) {
      return { status: "REJECTED", message: `action must be one of: ${STAFF_FORM_ACTIONS.join(", ")}.` };
    }
    if (action === "save") {
      const refusal = blocked(gate, (kind) => kind === "staff_save");
      if (refusal) return refusal;
    }
    const result = await staffFormVoice.run((form) => form.step(args as StaffFormArgs), 3_000);
    if (result.status === "REVIEW") ask(gate, "staff_save");
    // A change after the read-back means the earlier yes no longer covers what is on screen.
    if (["fill", "set_days", "services"].includes(action) && result.status === "OK" && gate.kind === "staff_save") clear(gate);
    if (result.status === "SAVED") clear(gate);
    return result;
  }

  if (name === MANAGE_STAFF_TOOL) {
    const action = text(args.action);
    if (action === "confirm") {
      const refusal = blocked(gate, (kind) => kind.startsWith("staff_") && kind !== "staff_save");
      if (refusal) return refusal;
      const result = await staffPageVoice.run((page) => page.confirm(), 3_000);
      if (result.status === "DONE") clear(gate);
      return result;
    }
    if (action === "cancel") {
      clear(gate);
      return staffPageVoice.run((page) => page.cancel(), 1_000);
    }
    if (action !== "suspend" && action !== "reactivate" && action !== "delete") {
      return { status: "REJECTED", message: "action must be suspend, reactivate, delete, confirm or cancel." };
    }
    const staffName = text(args.staffName);
    if (!staffName) return { status: "REJECTED", message: "Ask which staff member, then send staffName." };
    context.goTo(TEAM_STAFF_PAGE);
    clear(gate);
    const result = await staffPageVoice.run((page) => action === "delete"
      ? page.prepareDelete(staffName)
      : page.prepareStatus(staffName, action === "suspend" ? "suspended" : "active"));
    if (result.status === "CONFIRM") ask(gate, `staff_${action}`);
    return result;
  }

  if (name === LIST_LEAVE_TOOL) {
    const status = text(args.status) || "pending";
    if (!["pending", "approved", "rejected", "all"].includes(status)) {
      return { status: "REJECTED", message: "status must be pending, approved, rejected or all." };
    }
    const data = await getJson("/api/leave-requests", context);
    if (!Array.isArray(data?.leaveRequests)) return { status: "UNAVAILABLE", message: "Could not load leave requests." };
    if (leavePageVoice.isOpen()) void leavePageVoice.run((page) => page.setFilter(status as "pending"), 0);
    return summarizeLeave(data.leaveRequests as Parameters<typeof summarizeLeave>[0], status);
  }

  if (name === DECIDE_LEAVE_TOOL) {
    const action = text(args.action);
    const staffName = text(args.staffName);
    const fromDate = text(args.fromDate) || undefined;
    if (action === "approve" || action === "reject") {
      if (!staffName) return { status: "REJECTED", message: "Ask whose leave request, then send staffName." };
      const reason = text(args.reason);
      if (action === "reject" && reason.length < 2) return { status: "REJECTED", message: "Ask for the reason; the staff member will see it." };
      context.goTo(TEAM_LEAVE_PAGE);
      clear(gate);
      if (action === "reject") {
        const result = await leavePageVoice.run((page) => page.prepareReject(staffName, reason, fromDate));
        if (result.status === "CONFIRM") ask(gate, "leave_reject");
        return result;
      }
      const opened = await leavePageVoice.run((page) => page.prepareApprove(staffName, fromDate));
      if (opened.status !== "OPENED") return opened;
      // The dialog registers once it has checked the schedule for clashes.
      const described = await leaveApprovalVoice.run((dialog) => dialog.describe(), 15_000);
      if (described.status === "CONFIRM") ask(gate, "leave_approve");
      return described;
    }
    if (action === "cover") {
      if (gate.kind !== "leave_approve") return { status: "NOTHING_TO_CONFIRM", message: "Open the approve dialog first with action approve." };
      const conflictNumber = typeof args.conflictNumber === "number" ? args.conflictNumber : NaN;
      const result = await leaveApprovalVoice.run((dialog) => dialog.setCover(conflictNumber, text(args.coverBy) || "me"), 1_000);
      // The cover changed after the read-back: ask again.
      if (result.status === "CONFIRM") ask(gate, "leave_approve");
      return result;
    }
    if (action === "confirm") {
      const refusal = blocked(gate, (kind) => kind === "leave_approve" || kind === "leave_reject");
      if (refusal) return refusal;
      const result = gate.kind === "leave_approve"
        ? await leaveApprovalVoice.run((dialog) => dialog.submit(), 1_000)
        : await leavePageVoice.run((page) => page.confirmReject(), 1_000);
      if (result.status === "DONE") clear(gate);
      return result;
    }
    if (action === "cancel") {
      clear(gate);
      return leavePageVoice.run((page) => page.cancel(), 1_000);
    }
    return { status: "REJECTED", message: "action must be approve, reject, cover, confirm or cancel." };
  }

  if (name === SHOW_ATTENDANCE_TOOL) {
    const period = text(args.period);
    const view = text(args.view);
    const exportAs = text(args.export);
    if (period && !(ATTENDANCE_PERIODS as readonly string[]).includes(period)) return { status: "REJECTED", message: "period must be day, week, biweekly or month." };
    if (view && !(ATTENDANCE_VIEWS as readonly string[]).includes(view)) return { status: "REJECTED", message: "view must be sheet, all or staff." };
    if (exportAs && exportAs !== "pdf" && exportAs !== "excel") return { status: "REJECTED", message: "export must be pdf or excel." };
    context.goTo(TEAM_ATTENDANCE_PAGE);
    const request: AttendanceArgs = {
      period: (period || undefined) as AttendanceArgs["period"],
      date: text(args.date) || undefined,
      view: (view || undefined) as AttendanceArgs["view"],
      staffNames: list(args.staffNames),
      export: (exportAs || undefined) as AttendanceArgs["export"],
    };
    return attendancePageVoice.run((page) => page.show(request), 10_000);
  }

  return { status: "REJECTED", message: "Unknown team tool." };
}
