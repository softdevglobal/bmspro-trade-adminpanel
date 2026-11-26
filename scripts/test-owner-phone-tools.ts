import assert from "node:assert/strict";
import test from "node:test";
import { ownerPhoneToolDefinitions,parseOwnerPhoneTool } from "../lib/ai/calls/owner-phone-tools";
test("owner phone read tools cover calls and invoices without mutations or callback approval",()=>{
  const tools=ownerPhoneToolDefinitions(),names=tools.map(tool=>tool.name);
  for(const name of ["list_missed_calls","list_invoices","get_day_activity","get_daily_summary","get_sophie_call_summaries"])
    assert.equal(names.includes(name),true);
  assert.equal(tools.length,13);
  for(const name of ["confirm_change","create_job","prepare_owner_call","send_sms","list_customers"])
    assert.equal(parseOwnerPhoneTool(name,{}),null);
  assert.equal(parseOwnerPhoneTool("list_missed_calls",{followUp:true}),null);
  assert.equal(parseOwnerPhoneTool("list_invoices",{businessId:"another"}),null);
  assert.equal(parseOwnerPhoneTool("list_invoices",{invoiceStatus:"invented"}),null);
  assert.ok(parseOwnerPhoneTool("list_missed_calls",{date:"today"}));
  assert.ok(parseOwnerPhoneTool("list_invoices",{invoiceStatus:"sent",invoiceSearch:"INV 123"}));
  assert.ok(parseOwnerPhoneTool("list_quote_follow_ups",{includeDecided:true,search:"QT TEST123"}));
});
