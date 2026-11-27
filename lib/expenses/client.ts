"use client";

import type {
  ExpenseDuplicate,
  ExpenseRecord,
  ExpenseSettings,
} from "@/lib/expenses/types";
import type { User } from "firebase/auth";

export type ExpenseJobOption = { id: string; label: string; date: string | null };
export type ExpenseTeamMember = { uid: string; name: string; role: string };

export type ExpenseOptions = {
  canManage: boolean;
  todayIso: string;
  receiptReading: boolean;
  settings: ExpenseSettings;
  jobs: ExpenseJobOption[];
  team: ExpenseTeamMember[];
};

export class ExpenseApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly duplicate: ExpenseDuplicate | null = null,
  ) {
    super(message);
  }
}

export async function expenseRequest<T>(
  user: User,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | ({ ok?: boolean; error?: string; duplicate?: ExpenseDuplicate } & T)
    | null;
  if (!response.ok || !payload?.ok) {
    throw new ExpenseApiError(
      payload?.error ?? "Something went wrong. Try again.",
      response.status,
      payload?.duplicate ?? null,
    );
  }
  return payload;
}

export async function patchExpense(
  user: User,
  body: Record<string, unknown>,
): Promise<ExpenseRecord> {
  const result = await expenseRequest<{ expense: ExpenseRecord }>(user, "/api/expenses", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return result.expense;
}

const MAX_SIDE = 2000;
const TARGET_BYTES = 1_500_000;

/**
 * Phone photos are often several MB. Large images are scaled down to a
 * 2000px JPEG, which keeps receipts sharp and stays well under the upload
 * limit. Small JPEG/PNG/WebP files are sent as they are.
 */
export async function prepareReceiptImage(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new ExpenseApiError("Use a JPEG, PNG or WebP photo of the receipt.", 400);
  }
  if (file.size <= TARGET_BYTES) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ExpenseApiError("That photo couldn't be opened. Try a JPEG or PNG.", 400);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  return blob ?? file;
}

export async function uploadReceipt(
  user: User,
  file: File,
  options: { expenseId?: string | null; allowDuplicate?: boolean } = {},
): Promise<ExpenseRecord> {
  const image = await prepareReceiptImage(file);
  const form = new FormData();
  form.append("file", image, image === file ? file.name : "receipt.jpg");
  if (options.expenseId) form.append("expenseId", options.expenseId);
  if (options.allowDuplicate) form.append("allowDuplicate", "true");
  const result = await expenseRequest<{ expense: ExpenseRecord }>(user, "/api/expenses/receipt", {
    method: "POST",
    body: form,
  });
  return result.expense;
}

export async function downloadExpenseCsv(
  user: User,
  kind: "week" | "month",
  dateIso: string,
): Promise<void> {
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/expenses/reports?kind=${kind}&date=${encodeURIComponent(dateIso)}&format=csv`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!response.ok) throw new ExpenseApiError("Could not download the spreadsheet.", response.status);
  const blob = await response.blob();
  const name =
    /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ??
    `expenses-${kind}-${dateIso}.csv`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
