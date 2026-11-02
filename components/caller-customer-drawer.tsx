"use client";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useRegisterRightDrawer } from "@/lib/ui/right-drawer-slot";
type Customer = { uid: string; fullName: string; email: string; phone: string };
type Booking = { id: string; code: string; service: string; status: string; date: string | null; address: string };
export function CallerCustomerDrawer({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  useRegisterRightDrawer(true);
  useEffect(() => { closeRef.current?.focus(); const key = (event: KeyboardEvent) => { if(event.key === "Escape") onClose(); }; document.addEventListener("keydown",key); return () => document.removeEventListener("keydown",key); }, [onClose]);
  useEffect(() => {
    let cancelled = false;
    void (async () => { try {
      if (!user) return;
      const token = await user.getIdToken();
      const response = await fetch(`/api/customers/history?customerId=${encodeURIComponent(customer.uid)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load history.");
      if (!cancelled) setBookings(data.bookings || []);
    } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load history."); }
    finally { if (!cancelled) setLoading(false); } })();
    return () => { cancelled = true; };
  }, [customer.uid, user]);
  return createPortal(<div className="fixed inset-0 z-[80]">
    <button type="button" aria-label="Close customer details" onClick={onClose} className="absolute inset-0 bg-black/25" />
    <aside role="dialog" aria-modal="true" aria-label="Caller customer details" className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-outline-variant bg-surface shadow-2xl">
      <header className="flex items-center justify-between border-b border-outline-variant p-5"><h2 className="text-lg font-bold">Customer details</h2><button ref={closeRef} type="button" onClick={onClose} className="rounded-lg px-3 py-2 hover:bg-surface-container-low">Close</button></header>
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <div><p className="text-xs font-semibold text-emerald-700">Existing customer</p><h3 className="mt-1 text-xl font-bold">{customer.fullName}</h3><p className="mt-2 text-sm">{customer.phone}</p><p className="text-sm text-on-surface-variant">{customer.email}</p></div>
        <section><h3 className="mb-3 font-semibold">Booking history</h3>{loading ? <p>Loading bookings...</p> : error ? <p role="alert" className="text-rose-700">{error}</p> : !bookings.length ? <p className="text-sm text-on-surface-variant">No bookings found for this customer.</p> : <div className="space-y-3">{bookings.map(booking => <article key={booking.id} className="rounded-2xl border border-outline-variant p-4"><div className="flex justify-between gap-3"><p className="font-semibold">{booking.service}</p><span className="text-xs capitalize">{booking.status}</span></div><p className="mt-1 text-xs text-on-surface-variant">{booking.code}</p><p className="mt-2 text-sm">{booking.date || "Not scheduled"}</p>{booking.address ? <p className="text-sm text-on-surface-variant">{booking.address}</p> : null}</article>)}</div>}</section>
      </div>
    </aside>
  </div>, document.body);
}
