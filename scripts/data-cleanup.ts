/**
 * Data cleanup from the developer handoff.
 *
 * DRY RUN BY DEFAULT — prints exactly what it would change and writes nothing.
 * Review the output, then re-run with `--apply` to commit the changes.
 *
 *   npx tsx --env-file=.env.local scripts/data-cleanup.ts
 *   npx tsx --env-file=.env.local scripts/data-cleanup.ts --apply
 *
 * Optionally scope to one business:
 *   ... scripts/data-cleanup.ts --business=<businessId>
 */

import { adminDb } from "../lib/firebase/admin";
import { normaliseItemCode } from "../lib/validation/data-quality";

const APPLY = process.argv.includes("--apply");
const businessArg = process.argv
  .find((arg) => arg.startsWith("--business="))
  ?.split("=")[1]
  ?.trim();

/** Exact-match renames from the handoff document. */
const SERVICE_RENAMES: Record<string, string> = {
  "security cameras installation": "Security Camera Site Inspection",
  "security alarm system installation": "Alarm System Site Inspection",
  "intercom system installation and configuration": "Intercom Site Inspection",
};

const ITEM_RENAMES: Record<string, string> = {
  "replce exisiting cameras": "Replace existing cameras",
  "hi look braket": "HiLook Bracket",
  "4g sim annul plan": "4G SIM Annual Plan",
  "hikvison monitor": "Hikvision Monitor",
};

const CUSTOMER_RENAMES: Record<string, string> = {
  "titan intergrated electrical": "Titan Integrated Electrical",
};

const EMAIL_FIXES: Record<string, string> = {
  "suppot@acsu.com.au": "support@acsu.com.au",
};

type Change = {
  collection: string;
  docId: string;
  field: string;
  from: string;
  to: string;
  note?: string;
};

const changes: Change[] = [];

function scopedQuery(collection: string) {
  const base = adminDb.collection(collection);
  return businessArg ? base.where("businessId", "==", businessArg) : base;
}

async function renameField(
  collection: string,
  field: string,
  table: Record<string, string>,
) {
  const snap = await scopedQuery(collection).get();
  for (const doc of snap.docs) {
    const value = doc.data()?.[field];
    if (typeof value !== "string") continue;
    const target = table[value.trim().toLowerCase()];
    if (!target || target === value) continue;
    changes.push({
      collection,
      docId: doc.id,
      field,
      from: value,
      to: target,
    });
  }
}

/** Reports duplicate item codes without guessing which one to keep. */
async function reportDuplicateItemCodes() {
  const snap = await scopedQuery("items").get();
  const byCode = new Map<string, { id: string; name: string }[]>();

  for (const doc of snap.docs) {
    const data = doc.data() ?? {};
    const code = typeof data.code === "string" ? data.code : "";
    if (!code.trim()) continue;
    const key = normaliseItemCode(code);
    const list = byCode.get(key) ?? [];
    list.push({
      id: doc.id,
      name: typeof data.name === "string" ? data.name : "(unnamed)",
    });
    byCode.set(key, list);
  }

  let found = 0;
  for (const [code, items] of byCode) {
    if (items.length < 2) continue;
    found += 1;
    console.log(`\n  ⚠ Duplicate item code "${code}" used by ${items.length} items:`);
    for (const item of items) {
      console.log(`      - ${item.name} (${item.id})`);
    }
  }
  if (found === 0) console.log("  ✓ No duplicate item codes found.");
  else {
    console.log(
      `\n  ${found} duplicate code(s). Not auto-fixed — renaming a code in use\n` +
        "  can break existing quotations and invoices. Decide which to keep,\n" +
        "  then edit them in the Items page.",
    );
  }
}

async function main() {
  console.log(
    APPLY
      ? "=== DATA CLEANUP (APPLYING CHANGES) ==="
      : "=== DATA CLEANUP (DRY RUN — nothing will be written) ===",
  );
  if (businessArg) console.log(`Scoped to business: ${businessArg}\n`);

  await renameField("services", "name", SERVICE_RENAMES);
  await renameField("items", "name", ITEM_RENAMES);
  await renameField("customers", "fullName", CUSTOMER_RENAMES);
  await renameField("users", "email", EMAIL_FIXES);

  console.log(`\n--- Renames (${changes.length}) ---`);
  if (changes.length === 0) {
    console.log("  ✓ Nothing to rename.");
  } else {
    for (const change of changes) {
      console.log(
        `  ${change.collection}/${change.docId} · ${change.field}\n` +
          `      "${change.from}"\n   -> "${change.to}"`,
      );
    }
  }

  console.log("\n--- Duplicate item codes ---");
  await reportDuplicateItemCodes();

  if (!APPLY) {
    console.log(
      "\nDry run complete. Nothing was written.\n" +
        "Re-run with --apply to commit the renames above.",
    );
    return;
  }

  if (changes.length === 0) {
    console.log("\nNothing to apply.");
    return;
  }

  // Firestore caps a batch at 500 writes.
  const CHUNK = 400;
  for (let i = 0; i < changes.length; i += CHUNK) {
    const batch = adminDb.batch();
    for (const change of changes.slice(i, i + CHUNK)) {
      batch.update(adminDb.collection(change.collection).doc(change.docId), {
        [change.field]: change.to,
      });
    }
    await batch.commit();
  }
  console.log(`\n✓ Applied ${changes.length} rename(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Data cleanup failed:", error);
    process.exit(1);
  });
