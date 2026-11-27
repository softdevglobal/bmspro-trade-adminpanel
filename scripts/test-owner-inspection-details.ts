import assert from "node:assert/strict";
import test from "node:test";
import { ownerInspectionCallAllowed } from "../lib/ai/calls/owner-inspection-details";
const now=Date.now(),binding={businessId:"business-a",did:"0359111403"};
const row={...binding,purpose:"owner_notification",status:"CALLING",number:"0412345678",attemptedAt:now-1000,expiresAt:now+60000};
test("inspection details require a recent owner call to the saved destination",()=>{
  assert.equal(ownerInspectionCallAllowed(row,binding,"+61412345678",now),true);
  assert.equal(ownerInspectionCallAllowed({...row,status:"ANSWERED"},binding,"0412345678",now),true);
  for (const update of [{purpose:"missed_call"},{purpose:"owner_requested"},{businessId:"business-b"},{did:"0359111409"},{number:"0412345679"},{status:"OWNER_SCHEDULED"},{status:"FAILED"},{attemptedAt:now-16*60000},{attemptedAt:now+1},{expiresAt:now-1},{callLogId:"completed-call"}])
    assert.equal(ownerInspectionCallAllowed({...row,...update},binding,"0412345678",now),false);
  assert.equal(ownerInspectionCallAllowed(row,binding,null,now),false);
  assert.equal(ownerInspectionCallAllowed(row,binding,"0412345679",now),false);
});
