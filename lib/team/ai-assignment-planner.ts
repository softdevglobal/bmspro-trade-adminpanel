import { normalizeStaffDayAvailability, weekDayIdFromYmd } from "./staff-availability";

type Row = Record<string, any>;
export type AiStaffAssignment = {
  status: "assigned" | "needs_review";
  reason: string;
  assignedBy: "sophie" | "customer_portal";
  proposedSlot?: { date: string; timeRange: "morning" | "afternoon"; startTime: string; endTime: string };
};
const key = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
export const clockMinutes = (value: unknown): number | null => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
const clock = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** Exact configured skills/IDs only: free-text roles are never inferred by the model. */
export function staffCanPerformService(member: Row, service: Row): boolean {
  if (Array.isArray(service.staffIds) && service.staffIds.length) return service.staffIds.includes(member.id);
  if (Array.isArray(member.serviceIds)) return member.serviceIds.includes(service.id);
  const skill = key(service.requiredSkill);
  return !!skill && [...(Array.isArray(member.skills) ? member.skills : []), member.staffType].some(value => key(value) === skill);
}

export function planTradeStaffAssignment(input: {
  service: Row; staff: Row[]; slots: Row[]; leave: Row[]; work: Row[];
  closures: string[]; timezone: string; workingHours: { startTime: string; endTime: string };
  now: Date; durationMinutes: number; travelBufferMinutes: number; assignedBy?: AiStaffAssignment["assignedBy"];
}): { assignedTo: Row | null; aiAssignment: AiStaffAssignment } {
  const assignedBy = input.assignedBy ?? "sophie";
  const fail = (reason: string) => ({ assignedTo: null, aiAssignment: { status: "needs_review" as const, reason, assignedBy } });
  if (input.service.isActive !== true) return fail("Service is inactive.");
  const open = clockMinutes(input.workingHours.startTime), close = clockMinutes(input.workingHours.endTime);
  if (open == null || close == null || close <= open || !Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0 || input.durationMinutes > 540 || !Number.isInteger(input.travelBufferMinutes) || input.travelBufferMinutes < 0 || input.travelBufferMinutes > 180) return fail("Inspection duration or scheduling settings need review.");
  let localParts: Intl.DateTimeFormatPart[];
  try {
    localParts = new Intl.DateTimeFormat("en-GB", { timeZone: input.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(input.now);
  } catch { return fail("Business timezone needs review."); }
  const part = (type: string) => localParts.find(item => item.type === type)?.value || "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const currentMinutes = Number(part("hour")) * 60 + Number(part("minute"));
  for (const slot of input.slots) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date) || slot.date < today || input.closures.includes(slot.date) || !["morning", "afternoon"].includes(slot.timeRange)) continue;
    const weekday = weekDayIdFromYmd(slot.date, input.timezone);
    const sessionOpen = slot.timeRange === "morning" ? 480 : 720, sessionClose = slot.timeRange === "morning" ? 720 : 1020;
    const earliest = Math.max(open, sessionOpen, slot.date === today ? Math.ceil((currentMinutes + 1) / 15) * 15 : 0);
    const latest = Math.min(close, sessionClose);
    const candidates: Array<{ member: Row; start: number; load: number }> = [];
    for (const member of input.staff) {
      if (member.role !== "staff" || member.status !== "active" || member.suspended === true || !Array.isArray(member.availability) || !member.availability.length || !staffCanPerformService(member, input.service)) continue;
      if (member.availability.some((entry: unknown) => entry && typeof entry === "object") && !member.availability.some((entry: Row) => entry?.day === weekday && entry.isOff === false)) continue;
      if (normalizeStaffDayAvailability(member.availability).find(day => day.day === weekday)?.isOff !== false) continue;
      const memberWork = input.work.filter(item => item.assignedTo?.uid === member.id && !["cancelled", "completed", "missed"].includes(item.status));
      const load = memberWork.filter(item => (item.status === "pending" ? item.aiAssignment?.proposedSlot?.date : item.scheduledSlot?.date) === slot.date).reduce((sum, item) => { const a = clockMinutes(item.scheduledStartTime), b = clockMinutes(item.scheduledEndTime); return sum + (a != null && b != null && b > a ? b - a : 60); }, 0);
      for (let start = earliest; start + input.durationMinutes <= latest; start += 15) {
        const end = start + input.durationMinutes;
        if (input.leave.some(item => item.requesterUid === member.id && ["approved", "pending"].includes(item.status) && (!item.fromDate || slot.date >= item.fromDate && slot.date <= (item.toDate || item.fromDate) && (item.isFullDay !== false || clockMinutes(item.startTime) == null || clockMinutes(item.endTime) == null || clockMinutes(item.endTime)! <= clockMinutes(item.startTime)! || start < clockMinutes(item.endTime)! && clockMinutes(item.startTime)! < end)))) continue;
        if (memberWork.some(item => {
          const proposal = item.status === "pending" ? item.aiAssignment?.proposedSlot : null;
          const scheduled = proposal || item.scheduledSlot;
          if (scheduled?.date !== slot.date) return false;
          const a = clockMinutes(proposal?.startTime ?? item.scheduledStartTime) ?? (scheduled.timeRange === "afternoon" ? 720 : 480);
          const b = clockMinutes(proposal?.endTime ?? item.scheduledEndTime) ?? (scheduled.timeRange === "morning" ? 720 : 1020);
          return start < b + input.travelBufferMinutes && a - input.travelBufferMinutes < end;
        })) continue;
        candidates.push({ member, start, load });
        break;
      }
    }
    candidates.sort((a, b) => a.load - b.load || a.start - b.start || String(a.member.id).localeCompare(String(b.member.id)));
    const chosen = candidates[0];
    if (chosen) return {
      assignedTo: { type: "staff", uid: chosen.member.id, name: chosen.member.fullName || "Staff member", email: chosen.member.email || null },
      aiAssignment: { status: "assigned", assignedBy, reason: "Qualified staff member and available visit time selected.", proposedSlot: { date: slot.date, timeRange: slot.timeRange, startTime: clock(chosen.start), endTime: clock(chosen.start + input.durationMinutes) } },
    };
  }
  return fail("No qualified staff member is available for the customer's preferred sessions.");
}
