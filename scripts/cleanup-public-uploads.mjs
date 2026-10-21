import { securityAdmin } from "./security-admin.mjs";

const { db, storage } = securityAdmin();
// Preserve every referenced upload. Failures while collecting references abort
// cleanup, and the default command is a dry run.
const references = [];
async function collectReferences(collections) {
  for (const collection of collections) {
    const snap = await collection.get();
    for (const doc of snap.docs) {
      references.push(JSON.stringify(doc.data()));
      await collectReferences(await doc.ref.listCollections());
    }
  }
}
await collectReferences(await db.listCollections());
const bucket = storage.bucket();
let candidates = 0;
for (const prefix of ["business-logos/onboarding/", "booking-requests/"]) {
  const [files] = await bucket.getFiles({ prefix });
  for (const file of files) {
    if (prefix === "booking-requests/" && !file.name.split("/").includes("guest")) continue;
    const [metadata] = await file.getMetadata();
    const age = Date.now() - new Date(metadata.timeCreated).getTime();
    const retention = prefix === "business-logos/onboarding/" ? 86400_000 : 30 * 86400_000;
    if (!Number.isFinite(age) || age < retention) continue;
    const encoded = encodeURIComponent(file.name);
    if (references.some((data) => data.includes(file.name) || data.includes(encoded))) continue;
    candidates++;
    if (process.argv.includes("--apply")) await file.delete({ ifGenerationMatch: metadata.generation });
  }
}
console.log(`${process.argv.includes("--apply") ? "Deleted" : "Dry run candidates"}: ${candidates} expired, unreferenced public uploads.`);
