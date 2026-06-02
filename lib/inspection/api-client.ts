"use client";

import type { InspectionRequestDetail } from "@/lib/inspection/types";

type InspectionListResponse = {
  ok: boolean;
  requests?: InspectionRequestDetail[];
  error?: string;
};

export async function fetchBusinessInspectionRequests(
  idToken: string,
): Promise<InspectionRequestDetail[]> {
  const response = await fetch("/api/inspection-requests", {
    headers: { authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });
  const body = (await response.json()) as InspectionListResponse;
  if (!response.ok || !body.ok || !body.requests) {
    throw new Error(body.error ?? "Could not load inspection requests.");
  }
  return body.requests;
}
