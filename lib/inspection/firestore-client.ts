"use client";

import { db } from "@/lib/firebase/client";
import {
  mapInspectionDoc,
  sortInspectionRequestsNewestFirst,
} from "@/lib/inspection/map-inspection-doc";
import { INSPECTION_COLLECTION } from "@/lib/inspection/types";
import type { InspectionRequestDetail } from "@/lib/inspection/types";
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";

/** Caps initial/historical reads for the inspection visits board. */
export const INSPECTION_LIST_LIMIT = 200;

export function subscribeBusinessInspectionRequests(
  businessId: string,
  onData: (requests: InspectionRequestDetail[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, INSPECTION_COLLECTION),
    where("businessId", "==", businessId),
    limit(INSPECTION_LIST_LIMIT),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const requests = snapshot.docs.map((doc) =>
        mapInspectionDoc(doc.id, doc.data() as Record<string, unknown>),
      );
      onData(sortInspectionRequestsNewestFirst(requests));
    },
    (error) => onError?.(error),
  );
}
