"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { readJsonResponse } from "@/lib/api/read-json-response";
import type { DidBusinessOption, DidMappingInput, DidMappingRow } from "@/lib/ai/data/did-mapping-types";

const emptyForm: DidMappingInput = { did: "", businessId: "", isActive: true, version: 0 };
const inputClass = "w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60";

export function DidMappingsBoard() {
  const { user, role } = useAuth();
  const [mappings, setMappings] = useState<DidMappingRow[]>([]);
  const [businesses, setBusinesses] = useState<DidBusinessOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<DidMappingInput>(emptyForm);
  const [editing, setEditing] = useState<DidMappingRow | null>(null);
  const [showForm, setShowForm] = useState(false);

  const authHeaders = useCallback(async () => {
    if (!user || role !== "super_admin") throw new Error("Sign in as a super admin to manage phone numbers.");
    return { Authorization: `Bearer ${await user.getIdToken()}` };
  }, [user, role]);

  const fetchMappings = useCallback(async () => {
    const response = await fetch("/api/admin/ai/did-mappings", { headers: await authHeaders(), cache: "no-store" });
    const data = await readJsonResponse<{ ok: boolean; error?: string; mappings: DidMappingRow[]; businesses: DidBusinessOption[] }>(response);
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not load phone mappings.");
    return data;
  }, [authHeaders]);

  const load = useCallback(async () => {
    try {
      const data = await fetchMappings();
      setError("");
      setMappings(data.mappings);
      setBusinesses(data.businesses);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load phone mappings."); }
    finally { setLoading(false); }
  }, [fetchMappings]);
  useEffect(() => {
    let cancelled = false;
    void fetchMappings().then(data => {
      if (cancelled) return;
      setMappings(data.mappings); setBusinesses(data.businesses); setError(""); setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : "Could not load phone mappings."); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [fetchMappings]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return mappings.filter(mapping => `${mapping.did} ${mapping.businessName}`.toLowerCase().includes(query));
  }, [mappings, search]);

  async function persist(input: DidMappingInput) {
    const response = await fetch("/api/admin/ai/did-mappings", {
      method: "PUT", headers: { ...await authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const data = await readJsonResponse<{ ok: boolean; error?: string }>(response);
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not save the mapping.");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setMessage("");
    const did = form.did.trim();
    if (!editing && mappings.some(mapping => mapping.did === did)) {
      setError("This number is already mapped. Edit its existing mapping."); return;
    }
    if (form.isActive && !businesses.find(business => business.id === form.businessId)?.isActive) {
      setError("Choose an active business before enabling this number."); return;
    }
    setSaving(true);
    try {
      await persist({ ...form, did });
      setShowForm(false); setEditing(null); setForm(emptyForm);
      setMessage(`Mapping for ${did} saved.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the mapping."); }
    finally { setSaving(false); }
  }

  async function toggle(mapping: DidMappingRow) {
    setSaving(true); setError(""); setMessage("");
    try {
      await persist({ did: mapping.did, businessId: mapping.businessId, isActive: !mapping.isActive, version: mapping.version });
      setMessage(`${mapping.did} ${mapping.isActive ? "disabled" : "enabled"}.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update the mapping."); }
    finally { setSaving(false); }
  }

  function edit(mapping: DidMappingRow) {
    setEditing(mapping);
    setForm({ did: mapping.did, businessId: mapping.businessId, isActive: mapping.isActive, version: mapping.version });
    setShowForm(true); setError(""); setMessage("");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-on-surface">DID mappings</h1>
          <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">Connect each reception phone number to the Trade business Sophie should answer for.</p>
        </div>
        <button type="button" disabled={saving || loading} onClick={() => { setForm(emptyForm); setEditing(null); setShowForm(true); setError(""); setMessage(""); }}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary disabled:opacity-50">
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">add</span>Add mapping
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-error/30 bg-error-container px-4 py-3 text-sm text-on-error-container">{error}</div>}
      {message && <div role="status" className="rounded-xl border border-primary/20 bg-primary-fixed px-4 py-3 text-sm text-on-primary-fixed-variant">{message}</div>}

      {showForm && <form onSubmit={save} className="space-y-4 rounded-2xl border border-outline-variant bg-surface-container-lowest p-5">
        <h2 className="font-display text-lg font-semibold text-on-surface">{editing ? "Edit mapping" : "Add a phone number"}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="mapping-did" className="mb-1.5 block text-sm font-medium text-on-surface">Phone number (DID)</label>
            <input id="mapping-did" type="text" inputMode="numeric" autoComplete="off" pattern="[0-9]{6,15}" maxLength={15} required disabled={saving || !!editing}
              value={form.did} onChange={event => setForm(current => ({ ...current, did: event.target.value }))} placeholder="0359111403" className={inputClass} aria-describedby="mapping-did-help" />
            <p id="mapping-did-help" className="mt-1 text-xs text-on-surface-variant">Use the exact called number, including its leading zero. Digits only.</p>
          </div>
          <div>
            <label htmlFor="mapping-business" className="mb-1.5 block text-sm font-medium text-on-surface">Trade business</label>
            <select id="mapping-business" required disabled={saving} value={form.businessId} onChange={event => setForm(current => ({ ...current, businessId: event.target.value }))} className={inputClass}>
              <option value="">Choose a business</option>
              {form.businessId && !businesses.some(business => business.id === form.businessId) && <option value={form.businessId}>Unavailable business</option>}
              {businesses.map(business => <option key={business.id} value={business.id} disabled={!business.isActive && business.id !== form.businessId}>{business.name}{business.isActive ? "" : " (inactive)"}</option>)}
            </select>
          </div>
        </div>
        <label className="flex items-start gap-3 text-sm text-on-surface">
          <input type="checkbox" checked={form.isActive} disabled={saving} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} className="mt-0.5 accent-primary" />
          <span><span className="font-medium">Enable this number</span><span className="mt-0.5 block text-xs text-on-surface-variant">Disabled numbers cannot use Sophie’s Trade tools.</span></span>
        </label>
        {editing && editing.businessId !== form.businessId && <p className="rounded-lg bg-tertiary-fixed px-3 py-2 text-sm text-on-tertiary-fixed-variant">Changing the business redirects new calls. Current calls bound to the previous business will lose tool access.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary disabled:opacity-50">{saving ? "Saving…" : "Save mapping"}</button>
          <button type="button" disabled={saving} onClick={() => setShowForm(false)} className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-medium text-on-surface disabled:opacity-50">Cancel</button>
        </div>
      </form>}

      <section aria-label="Phone mappings" className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant p-4">
          <label className="min-w-0 flex-1 sm:max-w-sm"><span className="sr-only">Search phone numbers or businesses</span>
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search number or business" className={inputClass} />
          </label>
          <button type="button" onClick={() => { setLoading(true); void load(); }} disabled={loading || saving} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-primary disabled:opacity-50">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">refresh</span>Refresh
          </button>
        </div>
        {loading ? <p role="status" className="p-8 text-center text-sm text-on-surface-variant">Loading phone mappings…</p> : filtered.length === 0 ?
          <div className="p-10 text-center"><span className="material-symbols-outlined text-[32px] text-on-surface-variant" aria-hidden="true">phone_forwarded</span>
            <p className="mt-2 font-medium text-on-surface">{search ? "No matching phone numbers" : "No phone numbers mapped yet"}</p>
            <p className="mt-1 text-sm text-on-surface-variant">{search ? "Try another number or business name." : "Add a mapping to connect a number to a Trade business."}</p>
          </div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-surface-container-low text-xs text-on-surface-variant"><tr>
              <th scope="col" className="px-5 py-3 font-medium">Phone number</th><th scope="col" className="px-5 py-3 font-medium">Business</th><th scope="col" className="px-5 py-3 font-medium">Status</th><th scope="col" className="px-5 py-3 text-right font-medium">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-outline-variant/60">{filtered.map(mapping => <tr key={mapping.did}>
              <td className="whitespace-nowrap px-5 py-4 font-medium tabular-nums text-on-surface">{mapping.did}{mapping.source === "setup" && <span className="mt-1 block text-xs font-normal text-on-surface-variant">Existing setup · save to manage here</span>}</td>
              <td className="px-5 py-4 text-on-surface">{mapping.businessName}{!mapping.businessActive && <span className="mt-1 block text-xs text-error">Business unavailable · calls blocked</span>}</td>
              <td className="px-5 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${mapping.isActive && mapping.source === "dashboard" ? "bg-primary-fixed text-on-primary-fixed-variant" : "bg-surface-container-high text-on-surface-variant"}`}>{mapping.source === "setup" ? "Needs saving" : mapping.isActive ? "Enabled" : "Disabled"}</span></td>
              <td className="whitespace-nowrap px-5 py-4 text-right"><div className="inline-flex gap-1">
                <button type="button" disabled={saving} onClick={() => edit(mapping)} aria-label={`Edit mapping for ${mapping.did}`} className="rounded-lg px-3 py-2 font-medium text-primary disabled:opacity-50">Edit</button>
                <button type="button" disabled={saving || (!mapping.isActive && !mapping.businessActive)} onClick={() => void toggle(mapping)} aria-label={`${mapping.isActive ? "Disable" : "Enable"} ${mapping.did}`} className="rounded-lg px-3 py-2 font-medium text-on-surface-variant disabled:opacity-50">{mapping.isActive ? "Disable" : "Enable"}</button>
              </div></td>
            </tr>)}</tbody>
          </table></div>}
      </section>
      <p className="text-xs text-on-surface-variant">Route the number to the voice bridge in your phone system. The bridge discovers its Trade assignment from these saved mappings.</p>
    </div>
  );
}
