export type SlotCapacitySettings = {
  maxJobsPerHour: number;
  maxInspectionsPerHour: number;
};

export const DEFAULT_SLOT_CAPACITY: SlotCapacitySettings = {
  maxJobsPerHour: 1,
  maxInspectionsPerHour: 1,
};

const MIN_CAPACITY = 1;
const MAX_CAPACITY = 20;

function clampCapacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, Math.round(value)));
}

export function parseSlotCapacityFromBusiness(
  data: Record<string, unknown> | null | undefined,
): SlotCapacitySettings {
  const rawJobs = data?.slotCapacityJobs;
  const rawRequests = data?.slotCapacityInspectionRequests;

  const maxJobsPerHour =
    typeof rawJobs === "number"
      ? clampCapacity(rawJobs)
      : typeof rawJobs === "string" && rawJobs.trim()
        ? clampCapacity(Number.parseInt(rawJobs, 10))
        : DEFAULT_SLOT_CAPACITY.maxJobsPerHour;

  const maxInspectionsPerHour =
    typeof rawRequests === "number"
      ? clampCapacity(rawRequests)
      : typeof rawRequests === "string" && rawRequests.trim()
        ? clampCapacity(Number.parseInt(rawRequests, 10))
        : DEFAULT_SLOT_CAPACITY.maxInspectionsPerHour;

  return { maxJobsPerHour, maxInspectionsPerHour };
}

export function parseSlotCapacityInput(
  rawJobs: unknown,
  rawRequests: unknown,
): { ok: true; value: SlotCapacitySettings } | { ok: false; error: string } {
  const jobsNum =
    typeof rawJobs === "number"
      ? rawJobs
      : typeof rawJobs === "string"
        ? Number.parseInt(rawJobs, 10)
        : NaN;
  const requestsNum =
    typeof rawRequests === "number"
      ? rawRequests
      : typeof rawRequests === "string"
        ? Number.parseInt(rawRequests, 10)
        : NaN;

  if (!Number.isFinite(jobsNum) || jobsNum < MIN_CAPACITY || jobsNum > MAX_CAPACITY) {
    return {
      ok: false,
      error: `Jobs per hour must be between ${MIN_CAPACITY} and ${MAX_CAPACITY}.`,
    };
  }
  if (
    !Number.isFinite(requestsNum) ||
    requestsNum < MIN_CAPACITY ||
    requestsNum > MAX_CAPACITY
  ) {
    return {
      ok: false,
      error: `Inspection requests per hour must be between ${MIN_CAPACITY} and ${MAX_CAPACITY}.`,
    };
  }

  return {
    ok: true,
    value: {
      maxJobsPerHour: clampCapacity(jobsNum),
      maxInspectionsPerHour: clampCapacity(requestsNum),
    },
  };
}
