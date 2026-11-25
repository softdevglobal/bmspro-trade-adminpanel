# Telephone caller permissions

Phone calls remain on the customer MCP endpoint. Owner tools remain on the authenticated owner endpoint; spoken identity claims never change endpoints or permissions.

The bridge passes the network caller number as `X-BMSPro-Caller-Number` using its authenticated MCP transport. It is not a model argument. The backend compares it with the current business owner's enabled personal owner-call contact, or the current owner user's account phone. The business reception number is never an identity fallback. Missing, malformed, withheld or unmatched numbers stay customer calls. A match is `owner_candidate`, never authorization: caller ID can be spoofed and a different person may answer.

The owner contact can currently be saved in Settings → Calls to owner. Onboarding does not yet have a separate personal owner-phone field. This update does not treat the existing business phone as personal identity or silently migrate it.

Inbound direct-Trade calls check the authenticated caller-access endpoint before the first greeting, with a two-second deadline and a customer fallback on failure. A recognised contact hears a familiar Sophie greeting and does not enter the customer intake script unless they ask to book. Outbound owner notifications use a familiar business-assistant tone but still confirm the intended recipient before mentioning the notification. Inbound recognition does not grant private-data access. Outbound owner notifications have an explicit exception: the saved destination authorizes the linked-inspection lookup and a fixed allowlist of read-only owner business reports, as documented in owner-inspection-call-notifications.md. No extra verification step is used for that lookup. The recognition result contains no owner name or phone number.

Public services, contact information, approved public knowledge and permitted customer booking tools remain available. Private internal summaries, other customers' records, private invoices and owner management actions remain unavailable on telephone calls. Use signed-in Talk to Sophie for owner access until a verified telephone authorization flow is implemented.

Pass `__BMS_CALLER_ID=${CALLERID(num)}` from the inbound Asterisk dialplan to the WebSocket channel if it is not already provided. Missing metadata fails closed. Never take this value from caller speech. Keep the MCP bridge credential server-side.

Deploy Trade and the updated bridge together. Recognition failure preserves customer access. Test a normal caller, withheld caller, saved owner contact, a caller claiming to be the owner and private-data requests. No live calls are placed by the automated tests.
