/** Sort chat list rows by updatedAt descending (avoids composite Firestore indexes). */
export function sortByUpdatedAtDesc<T extends { updatedAt: number | null }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  );
}

/** Sort message rows by timestamp/createdAt descending. */
export function sortByTimeDesc(
  items: Array<{ timestamp?: number | null; createdAt?: number | null }>,
): typeof items {
  return [...items].sort((a, b) => {
    const aTime = a.timestamp ?? a.createdAt ?? 0;
    const bTime = b.timestamp ?? b.createdAt ?? 0;
    return bTime - aTime;
  });
}
