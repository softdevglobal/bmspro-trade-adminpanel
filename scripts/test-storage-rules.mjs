import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

const environment = await initializeTestEnvironment({ projectId: "demo-bms-security-test", storage: {
  host: "127.0.0.1", port: 9199, rules: readFileSync(new URL("../storage.rules", import.meta.url), "utf8"),
} });
await environment.withSecurityRulesDisabled(async (context) => {
  await uploadBytes(ref(context.storage(), "business-logos/biz-a/logo.png"), new Uint8Array([1]));
  await uploadBytes(ref(context.storage(), "careplus-evidence/biz-a/private.pdf"), new Uint8Array([1]));
});
const anonymous = environment.unauthenticatedContext().storage();
await assertSucceeds(getDownloadURL(ref(anonymous, "business-logos/biz-a/logo.png")));
await assertFails(getDownloadURL(ref(anonymous, "careplus-evidence/biz-a/private.pdf")));
await assertFails(uploadBytes(ref(anonymous, "business-logos/onboarding/forged.png"), new Uint8Array([1])));
const owner = environment.authenticatedContext("owner-a", { role: "owner", businessId: "biz-a" }).storage();
await assertFails(uploadBytes(ref(owner, "careplus-evidence/biz-b/forged.pdf"), new Uint8Array([1])));
await environment.cleanup();
console.log("4 Storage rule checks passed.");
