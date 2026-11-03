import { adminDb } from "../lib/firebase/admin";
import { parseVoiceBusinesses } from "../lib/ai/config";
import { DID_MAPPINGS_COLLECTION, saveVoiceDidMapping } from "../lib/ai/data/did-mappings";

async function main() {
  const mappings = parseVoiceBusinesses(process.env.AI_VOICE_TRADE_DID_CONFIG_JSON ?? "[]");
  for (const binding of mappings) {
    const existing = await adminDb.collection(DID_MAPPINGS_COLLECTION).doc(binding.did).get();
    if (existing.exists) { console.log(`${binding.did}: dashboard mapping preserved.`); continue; }
    await saveVoiceDidMapping({ ...binding, isActive: true, version: 0 }, { uid: null, role: "system" });
    console.log(`${binding.did}: setup mapping saved to dashboard storage.`);
  }
}
main().then(() => process.exit(0)).catch(() => { console.error("DID migration failed; existing dashboard mappings were not overwritten."); process.exit(1); });
