/** Client-safe slot occupancy shape (matches API / server occupancy). */
export type HourSlotOccupancy = {
  startTime: string;
  endTime: string;
  jobCount: number;
  requestCount: number;
  personalCount: number;
  maxJobs: number;
  maxRequests: number;
  jobsFull: boolean;
  requestsFull: boolean;
};

export type DaySlotOccupancy = {
  date: string;
  slots: HourSlotOccupancy[];
};

export function occupancyForHour(
  slots: HourSlotOccupancy[] | undefined,
  startTime: string,
): HourSlotOccupancy | undefined {
  return slots?.find((slot) => slot.startTime === startTime);
}
