import assert from "node:assert/strict";
import test from "node:test";
import { classifyPhoneCaller } from "../lib/ai/calls/caller-access";

test("owner number matches normalize AU and Sri Lankan formats without granting rights", () => {
  for (const [caller, saved] of [["+61 412 345 678", "0412345678"], ["0094766524216", "94766524216"]]) {
    assert.deepEqual(classifyPhoneCaller(caller, saved), {role:"owner_candidate",ownerAccess:false,verificationRequired:true});
  }
});
test("missing, withheld, malformed and other numbers stay customers", () => {
  for (const caller of [null, "", "anonymous", "I am the owner", "0412345679", "+61412345678\r\nX-Test: yes", {}, "123"])
    assert.deepEqual(classifyPhoneCaller(caller, "0412345678"), {role:"customer",ownerAccess:false,verificationRequired:true});
  assert.equal(classifyPhoneCaller("0412345678", null).role, "customer");
});
