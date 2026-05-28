import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/onboarding/services/collections";
import { formatServiceDuration, toMillis } from "@/lib/onboarding/services/display";
import { iconForServiceSkill } from "@/lib/onboarding/services/types";

export type BookingServiceTask = {
  id: string;
  title: string;
  description: string;
};

/** Public-facing service row on the booking page. */
export type BookingService = {
  id: string;
  name: string;
  businessType: string;
  defaultDurationMin: number;
  durationLabel: string;
  taskCount: number;
  tasks: BookingServiceTask[];
  imageUrl: string | null;
  skillIcon: string;
};

function mapEmbeddedTasks(raw: unknown): BookingServiceTask[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const task = item as Record<string, unknown>;
      if (task.customerVisible === false) return null;

      const title = typeof task.title === "string" ? task.title.trim() : "";
      if (!title) return null;

      const id =
        typeof task.id === "string" && task.id.trim()
          ? task.id.trim()
          : `task-${index}`;

      return {
        id,
        title,
        description:
          typeof task.description === "string" ? task.description.trim() : "",
        sortOrder:
          typeof task.sortOrder === "number" ? task.sortOrder : index,
      };
    })
    .filter(
      (
        task,
      ): task is BookingServiceTask & { sortOrder: number } => task !== null,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ id, title, description }) => ({ id, title, description }));
}

function mapBookingService(
  id: string,
  data: Record<string, unknown>,
): BookingService | null {
  if (data.isActive === false) return null;
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) return null;

  const businessType =
    typeof data.businessType === "string"
      ? data.businessType
      : typeof data.category === "string"
        ? data.category
        : "";

  const defaultDurationMin =
    typeof data.defaultDurationMin === "number" && data.defaultDurationMin > 0
      ? data.defaultDurationMin
      : 60;

  const tasks = mapEmbeddedTasks(data.tasks);
  const requiredSkill =
    typeof data.requiredSkill === "string" ? data.requiredSkill : businessType;

  return {
    id,
    name,
    businessType,
    defaultDurationMin,
    durationLabel: formatServiceDuration(defaultDurationMin),
    taskCount: tasks.length,
    tasks,
    imageUrl:
      typeof data.imageUrl === "string" && data.imageUrl.trim()
        ? data.imageUrl.trim()
        : null,
    skillIcon: iconForServiceSkill(requiredSkill),
  };
}

/** Active services for a business, newest first. */
export async function loadBookingServices(
  businessId: string,
): Promise<BookingService[]> {
  const snapshot = await adminDb
    .collection(COLLECTIONS.SERVICES)
    .where("businessId", "==", businessId)
    .get();

  const withTime = snapshot.docs
    .map((doc) => ({
      service: mapBookingService(doc.id, doc.data()),
      createdAt: toMillis(doc.data()?.createdAt) ?? 0,
    }))
    .filter(
      (row): row is { service: BookingService; createdAt: number } =>
        row.service !== null,
    );

  withTime.sort((a, b) => b.createdAt - a.createdAt);
  return withTime.map((row) => row.service);
}
