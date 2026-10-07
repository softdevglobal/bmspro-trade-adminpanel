"use client";

import { useCallback, useEffect, useState } from "react";
import { MonthCalendarField } from "@/components/month-calendar-field";
import { JOB_ESTIMATE_SELECT_CHEVRON } from "@/lib/bookings/job-estimate";
import { platformTodayIso } from "@/lib/platform/timezone";
import { useAuth } from "@/lib/auth/auth-context";
import type { CareplusProviderProfile } from "@/lib/integrations/careplus/provider-profile";
import { fillProviderDetails } from "@/lib/participant-onboarding/provider-details";
import { createOnboardingTemplate, createPackOverview, createRiskSection, createSupportSchedule, upgradeOnboardingDraft } from "@/lib/participant-onboarding/template";
import { FIELD_TYPES, validateOnboarding, type FieldType, type OnboardingInput, type OnboardingRecord, type OnboardingSection } from "@/lib/participant-onboarding/types";

type Summary = Pick<OnboardingRecord, "id" | "participantName" | "participantReference" | "status" | "updatedAt" | "revision">;
type ApiResult = { careplusSync?: "sent" | "pending" | "failed" | "not_connected"; records?: Summary[]; nextCursor?: string | null; record?: OnboardingRecord; connected?: boolean; profile?: CareplusProviderProfile | null };
const inputClass = "min-h-11 w-full rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60";
const selectClass = inputClass + " appearance-none bg-[length:0.875rem] bg-[right_1.1rem_center] bg-no-repeat pr-9";
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-4 py-2 font-body text-[13px] font-semibold text-on-surface transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50";
const primaryClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50";

function freshSection(section: OnboardingSection): OnboardingSection {
  return { ...section, id: crypto.randomUUID(), fields: section.fields.map((field) => ({ ...field, id: crypto.randomUUID(), value: "" })) };
}

function BirthDateFields({ value, disabled, onChange }: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [year, setYear] = useState(value.split("-")[0] || "");
  const [month, setMonth] = useState(value.split("-")[1] || "");
  const [day, setDay] = useState(value.split("-")[2] || "");

  const monthOptions = Array.from({ length: 12 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return { number, label: new Intl.DateTimeFormat("en-AU", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, index, 1))) };
  });
  const daysInMonth = year && month ? new Date(Number(year), Number(month), 0).getDate() : 31;
  const years = Array.from({ length: new Date().getFullYear() - 1895 }, (_, index) => String(new Date().getFullYear() - index));

  function updateDate(nextYear: string, nextMonth: string, nextDay: string) {
    const maxDay = nextYear && nextMonth ? new Date(Number(nextYear), Number(nextMonth), 0).getDate() : 31;
    const safeDay = nextDay && Number(nextDay) > maxDay ? String(maxDay).padStart(2, "0") : nextDay;
    setYear(nextYear); setMonth(nextMonth); setDay(safeDay);
    onChange(nextYear && nextMonth && safeDay ? `${nextYear}-${nextMonth}-${safeDay}` : "");
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      <select aria-label="Birth year" disabled={disabled} className={selectClass} style={{ backgroundImage: JOB_ESTIMATE_SELECT_CHEVRON }} value={year} onChange={(event) => updateDate(event.target.value, month, day)}>
        <option value="">Year</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <select aria-label="Birth month" disabled={disabled} className={selectClass} style={{ backgroundImage: JOB_ESTIMATE_SELECT_CHEVRON }} value={month} onChange={(event) => updateDate(year, event.target.value, day)}>
        <option value="">Month</option>{monthOptions.map((item) => <option key={item.number} value={item.number}>{item.label}</option>)}
      </select>
      <select aria-label="Birth day" disabled={disabled} className={selectClass} style={{ backgroundImage: JOB_ESTIMATE_SELECT_CHEVRON }} value={day} onChange={(event) => updateDate(year, month, event.target.value)}>
        <option value="">Day</option>{Array.from({ length: daysInMonth }, (_, index) => String(index + 1).padStart(2, "0")).map((item) => <option key={item} value={item}>{Number(item)}</option>)}
      </select>
    </div>
  );
}

export function ParticipantOnboardingBoard() {
  const { user, businessId } = useAuth();
  const [view, setView] = useState<"saved" | "form">("saved");
  const [records, setRecords] = useState<Summary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [form, setForm] = useState<OnboardingInput | null>(null);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [formSessionId, setFormSessionId] = useState("");
  const [revision, setRevision] = useState(0);
  const [activeId, setActiveId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [editStructure, setEditStructure] = useState(false);
  const [showSectionBuilder, setShowSectionBuilder] = useState(false);
  const [sectionKind, setSectionKind] = useState("custom");
  const [sectionName, setSectionName] = useState("");
  const [firstQuestion, setFirstQuestion] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<FieldType>("text");
  const [newOptions, setNewOptions] = useState("");
  const [providerProfile, setProviderProfile] = useState<CareplusProviderProfile | null>(null);
  const [providerNote, setProviderNote] = useState("");

  const api = useCallback(async (query = "", body?: object): Promise<ApiResult> => {
    if (!user) throw new Error("Please sign in again.");
    const token = await user.getIdToken();
    const response = await fetch("/api/participant-onboarding" + query, {
      method: body ? "POST" : "GET", cache: "no-store",
      headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not complete the request.");
    return result;
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    if (!user || !businessId) return;
    api().then((result) => {
      if (cancelled) return;
      setRecords(result.records || []);
      setNextCursor(result.nextCursor || null);
      setView("saved");
      setForm(null);
      setRecordId(null);
      setDirty(false);
      setError("");
    }).catch((reason) => { if (!cancelled) setError(reason.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, user, businessId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    // Dashboard links use client navigation, which does not fire beforeunload.
    const warnLink = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (target && !window.confirm("You have unsaved onboarding changes. Leave this page?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", warnLink, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", warnLink, true); };
  }, [dirty]);


  async function readProviderDetails(): Promise<{ profile: CareplusProviderProfile | null; note: string }> {
    try {
      const result = await api("/provider");
      return result.connected && result.profile
        ? { profile: result.profile, note: "Business details loaded from your connected CarePlus account." }
        : { profile: null, note: "Connect a CarePlus business account to prefill provider details, or enter them manually." };
    } catch (reason) {
      return { profile: null, note: reason instanceof Error ? reason.message : "CarePlus business details could not be loaded. Enter them manually or retry autofill." };
    }
  }

  function canSwitch() { return !dirty || window.confirm("Discard unsaved changes and continue?"); }
  function change(patch: Partial<OnboardingInput>) {
    setForm((previous) => previous ? { ...previous, ...patch } : previous);
    setDirty(true); setNotice(""); setError("");
  }
  function updateSection(id: string, update: (section: OnboardingSection) => OnboardingSection) {
    if (form) change({ sections: form.sections.map((section) => section.id === id ? update(section) : section) });
  }

  async function startNew() {
    if (!canSwitch()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const defaults = await readProviderDetails();
      const sections = createOnboardingTemplate();
      const prepared = fillProviderDetails({ participantName: "", participantReference: "", status: "draft", templateVersion: 2, sections }, defaults.profile);
      setShowSectionBuilder(false);
      setView("form");
      setFormSessionId(crypto.randomUUID());
      setForm(prepared.form); setProviderProfile(defaults.profile); setProviderNote(defaults.note);
      setActiveId(sections[0].id); setRecordId(null); setRevision(0); setDirty(prepared.filledFields > 0);
      setEditStructure(false); setNewLabel("");
      if (prepared.filledFields) setNotice("Provider details have been filled from CarePlus. Review them and save the form.");
    } finally { setBusy(false); }
  }

  async function openRecord(id: string) {
    if (!canSwitch()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const [result, defaults] = await Promise.all([api("?id=" + encodeURIComponent(id)), readProviderDetails()]);
      if (!result.record) throw new Error("Record data is unavailable.");
      const record = result.record;
      const prepared = upgradeOnboardingDraft({
        participantName: record.participantName, participantReference: record.participantReference,
        status: record.status, sections: record.sections, templateVersion: record.templateVersion,
      });
      const autofilled = fillProviderDetails(prepared.form, defaults.profile);
      setShowSectionBuilder(false);
      setView("form");
      setFormSessionId(crypto.randomUUID());
      setForm(autofilled.form); setProviderProfile(defaults.profile); setProviderNote(defaults.note);
      setRecordId(record.id); setRevision(record.revision); setActiveId(autofilled.form.sections[0]?.id || "");
      setDirty(prepared.addedOverview || prepared.addedChoices || autofilled.filledFields > 0); setEditStructure(false); setNewLabel("");
      const notices = [
        prepared.addedOverview ? "The opening page has been added to this draft." : "",
        prepared.addedChoices ? "Dropdowns for contact method and language have been added. Your previous answers were kept for review." : "",
        autofilled.filledFields ? "Blank provider fields have been filled from CarePlus." : "",
      ].filter(Boolean);
      if (notices.length) setNotice(notices.join(" ") + " Save changes to keep them.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open record."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!form) return;
    setError(""); setNotice("");
    try {
      const intakeName = form.sections
        .find((section) => section.id === "intake-a")
        ?.fields.find((field) => field.label.trim().toLowerCase() === "full name")
        ?.value.trim();
      if (!intakeName) throw new Error("Enter the participant’s full name in the Participant intake section before saving.");
      const input = validateOnboarding({ ...form, participantName: intakeName });
      setBusy(true);
      const result = await api("", { ...input, ...(recordId ? { id: recordId, revision } : {}) });
      if (!result.record) throw new Error("Save response is unavailable.");
      const saved = result.record;
      setRecordId(saved.id); setRevision(saved.revision); setForm(input); setDirty(false);
      setRecords((previous) => [saved, ...previous.filter((record) => record.id !== saved.id)]);
      setNotice(result.careplusSync === "sent"
        ? "Onboarding saved in Trade. The participant is now available in CarePlus Participants."
        : result.careplusSync === "not_connected"
          ? "Onboarding saved in Trade. Connect CarePlus and save again to send the participant."
          : result.careplusSync === "failed"
            ? "Onboarding saved in Trade, but CarePlus rejected the participant transfer. Check the CarePlus connection and integration errors, then save again."
            : "Onboarding saved in Trade. The participant transfer is queued and will appear in CarePlus after synchronization.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save onboarding."); }
    finally { setBusy(false); }
  }
  async function loadMore() {
    if (!nextCursor) return;
    setBusy(true); setError("");
    try {
      const result = await api("?cursor=" + encodeURIComponent(nextCursor));
      setRecords((previous) => [...previous, ...(result.records || []).filter((record) => !previous.some((item) => item.id === record.id))]);
      setNextCursor(result.nextCursor || null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load more records."); }
    finally { setBusy(false); }
  }
  function addSection(section: OnboardingSection) {
    if (!form || form.sections.length >= 50) return;
    const fresh = freshSection(section);
    const prepared = fillProviderDetails({ ...form, sections: [fresh] }, providerProfile);
    change({ sections: [...form.sections, ...prepared.form.sections] }); setActiveId(fresh.id); setNewLabel("");
  }
  function createSection() {
    if (sectionKind === "custom" && (!sectionName.trim() || !firstQuestion.trim())) return;
    const section = sectionKind === "support" ? createSupportSchedule()
      : sectionKind === "risk" ? createRiskSection()
      : sectionKind === "overview" ? createPackOverview()
      : { id: "", title: sectionName.trim(), description: "", fields: [
          { id: "", label: firstQuestion.trim(), type: "textarea" as const, value: "" },
        ] };
    if (totalFields + section.fields.length > 600) { setError("This form has reached its question limit. Remove unused questions before adding another section."); return; }
    addSection(section);
    setShowSectionBuilder(false); setSectionName(""); setFirstQuestion(""); setEditStructure(false);
    requestAnimationFrame(() => {
      document.getElementById("onboarding-section-heading")?.focus();
    });
  }
  function removeSection(section: OnboardingSection) {
    if (!form || form.sections.length === 1 || !window.confirm('Remove "' + section.title + '" and its responses?')) return;
    const sections = form.sections.filter((item) => item.id !== section.id);
    change({ sections }); setActiveId(sections[0].id);
  }
  function moveSection(id: string, direction: number) {
    if (!form) return;
    const sections = [...form.sections];
    const index = sections.findIndex((item) => item.id === id);
    if (index + direction < 0 || index + direction >= sections.length) return;
    [sections[index], sections[index + direction]] = [sections[index + direction], sections[index]];
    change({ sections });
  }
  const active = form?.sections.find((section) => section.id === activeId);
  const index = form?.sections.findIndex((section) => section.id === activeId) ?? 0;
  const totalFields = form?.sections.reduce((total, section) => total + section.fields.length, 0) || 0;
  const filledFields = form?.sections.reduce((total, section) => total + section.fields.filter((field) => field.value.trim()).length, 0) || 0;
  const filtered = records.filter((record) => (record.participantName + " " + record.participantReference).toLowerCase().includes(search.toLowerCase()));
  function addField() {
    if (!active || !newLabel.trim()) return;
    const options = [...new Set(newOptions.split(",").map((item) => item.trim()).filter(Boolean))];
    if (newType === "select" && (options.length === 0 || options.length > 30)) { setError("Enter between 1 and 30 comma-separated choices."); return; }
    updateSection(active.id, (section) => ({ ...section, fields: [...section.fields, {
      id: crypto.randomUUID(), label: newLabel.trim(), type: newType, value: "", ...(newType === "select" ? { options } : {}),
    }] }));
    setNewLabel(""); setNewOptions("");
  }

  return (
    <div className="space-y-5 font-body text-on-surface">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-on-surface-variant">Use the NDIS onboarding template, add sections and fields, and save a separate record for each participant.</p>
        <button className={primaryClass} disabled={busy || loading} onClick={() => void startNew()}>{busy ? "Please wait…" : "New participant onboarding"}</button>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}
      <div role="tablist" aria-label="Participant onboarding views" className="flex gap-2 border-b border-outline-variant/50 pb-3">
        {(["form", "saved"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={"onboarding-tab-" + tab}
            aria-selected={view === tab}
            aria-controls={"onboarding-panel-" + tab}
            tabIndex={view === tab ? 0 : -1}
            className={view === tab ? primaryClass : buttonClass}
            onClick={() => setView(tab)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "form" : event.key === "End" ? "saved" : tab === "saved" ? "form" : "saved";
              setView(next);
              document.getElementById("onboarding-tab-" + next)?.focus();
            }}
          >
            {tab === "saved" ? "Saved onboarding" : "Onboarding form"}
          </button>
        ))}
      </div>
      <div className="space-y-5">
        <section role="tabpanel" id="onboarding-panel-saved" aria-labelledby="onboarding-tab-saved" hidden={view !== "saved"} className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-4">
          <h2 className="mb-3 font-semibold text-on-surface">Saved onboarding</h2>
          <label className="mb-3 block"><span className="sr-only">Search saved participants</span><input className={inputClass} placeholder="Search name or reference" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          {loading ? <p role="status" className="font-body text-[13px] text-on-surface-variant">Loading records…</p> : (
            <div className="max-h-[550px] space-y-2 overflow-y-auto">
              {filtered.map((record) => (
                <button key={record.id} disabled={busy} onClick={() => void openRecord(record.id)} className={"w-full rounded-lg border p-3 text-left disabled:opacity-40 " + (recordId === record.id ? "border-primary bg-primary/5" : "border-outline-variant/40 hover:bg-surface-container")}>
                  <span className="block font-medium text-on-surface">{record.participantName}</span>
                  <span className="block text-xs text-on-surface-variant">{record.participantReference || "No reference"} · {record.status}</span>
                  <span className="block text-xs text-on-surface-variant">Updated {new Date(record.updatedAt).toLocaleDateString()}</span>
                </button>
              ))}
              {!filtered.length && <p className="font-body text-[13px] text-on-surface-variant">{search ? "No matching participants in the loaded records." : "No saved onboarding records yet."}</p>}
            </div>
          )}
          {nextCursor && <button disabled={busy} onClick={() => void loadMore()} className={buttonClass + " mt-3 w-full"}>Load more records</button>}
        </section>
        <div role="tabpanel" id="onboarding-panel-form" aria-labelledby="onboarding-tab-form" hidden={view !== "form"}>
        {!form ? <div className="rounded-xl border border-dashed border-outline-variant p-10 text-center"><h2 className="text-lg font-semibold text-on-surface">Start a participant onboarding</h2><p className="mt-2 text-sm text-on-surface-variant">Create a new form or open a saved record. Drafts can be saved before every section is filled.</p></div> : (
          <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="min-w-0 space-y-4">
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              <div className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="space-y-1 font-body text-[13px] font-semibold">Record status<select className={selectClass} style={{ backgroundImage: JOB_ESTIMATE_SELECT_CHEVRON }} value={form.status} onChange={(event) => change({ status: event.target.value as OnboardingInput["status"] })}><option value="draft">Draft</option><option value="completed">Completed</option></select></label>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="font-body text-[12px] text-on-surface-variant">{filledFields} / {totalFields} fields answered · {dirty ? "Unsaved changes" : recordId ? "Saved" : "New form"}</span>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className={primaryClass}>{busy ? "Working…" : recordId ? "Save changes" : "Save onboarding"}</button>
                  </div>
                </div>
                {providerNote && <p role="status" className="mt-3 text-sm text-on-surface-variant">{providerNote}</p>}
                <p className="mt-2 font-body text-[12px] text-on-surface-variant">Completed is a record status. It does not grant consent or replace a participant’s agreement. Signature fields record names or agreement details; use your agreed signing process.</p>
              </div>
              {showSectionBuilder && <div id="onboarding-section-builder" className="space-y-4 rounded-xl border border-primary/40 bg-surface-container-lowest p-5">
                <div><h2 className="text-lg font-semibold">Add a section</h2><p className="mt-1 text-sm text-on-surface-variant">Choose a ready-made section, or create your own with a first question.</p></div>
                <label className="block space-y-1 font-body text-[13px] font-semibold">1. What would you like to add?
                  <select id="section-kind" className={selectClass} style={{ backgroundImage: JOB_ESTIMATE_SELECT_CHEVRON }} value={sectionKind} onChange={(event) => setSectionKind(event.target.value)}>
                    <option value="custom">My own section</option>
                    <option value="support">Support schedule — services, times and prices</option>
                    <option value="risk">Risk and safeguards — risks and agreed actions</option>
                    <option value="overview">Provider details — opening page of the pack</option>
                  </select>
                </label>
                {sectionKind === "custom" ? <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-1 font-body text-[13px] font-semibold">2. Name your section
                    <input className={inputClass} maxLength={200} placeholder="For example: Transport needs" value={sectionName} onChange={(event) => setSectionName(event.target.value)} />
                  </label>
                  <label className="block space-y-1 font-body text-[13px] font-semibold">3. Add your first question
                    <input className={inputClass} maxLength={300} placeholder="For example: What transport support is needed?" value={firstQuestion} onChange={(event) => setFirstQuestion(event.target.value)} />
                  </label>
                  <p className="text-sm text-on-surface-variant sm:col-span-2">An answer box will be added for this question. You can add more questions after creating the section.</p>
                </div> : <p className="font-body text-[13px] text-on-surface-variant">This section already includes the questions you need. Add it, then fill in the answers.</p>}
                <div className="flex gap-2">
                  <button type="button" className={primaryClass} disabled={form.sections.length >= 50 || (sectionKind === "custom" && (!sectionName.trim() || !firstQuestion.trim() || totalFields >= 600))} onClick={createSection}>Add section and open it</button>
                  <button type="button" className={buttonClass} onClick={() => setShowSectionBuilder(false)}>Cancel</button>
                </div>
              </div>}
              <div className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="space-y-3">
                  <nav aria-label="Onboarding sections" className="max-h-[520px] space-y-1 overflow-y-auto rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-2">
                    {form.sections.map((section, number) => <button type="button" key={section.id} aria-current={activeId === section.id ? "step" : undefined} onClick={() => { setActiveId(section.id); setNewLabel(""); }} className={"w-full rounded-lg px-3 py-2 text-left text-sm " + (activeId === section.id ? "bg-primary/10 font-semibold text-primary" : "text-on-surface-variant hover:bg-surface-container")}><span className="mr-2 text-xs">{number + 1}.</span>{section.title}</button>)}
                  </nav>
                  <div className="space-y-2 rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-3">
                    <button type="button" disabled={form.sections.length >= 50} className={primaryClass + " w-full"} aria-expanded={showSectionBuilder} aria-controls="onboarding-section-builder" onClick={() => {
                      setShowSectionBuilder(true);
                      requestAnimationFrame(() => document.getElementById("section-kind")?.focus());
                    }}>+ Add a section</button>
                    <p className="font-body text-[12px] text-on-surface-variant">A section groups related questions, such as transport needs or emergency contacts.</p>
                    {form.sections.length >= 50 && <p className="font-body text-[12px] text-on-surface-variant">You have reached the limit of 50 sections.</p>}
                  </div>
                </div>
                {active && <section className="min-w-0 rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="onboarding-section-heading" tabIndex={-1} className="text-lg font-semibold text-on-surface">{active.title}</h2><button type="button" className={buttonClass} onClick={() => setEditStructure(!editStructure)}>{editStructure ? "Done editing" : "Rename / organise"}</button></div>
                  {editStructure ? <div className="mb-5 space-y-3 rounded-lg bg-surface-container p-3">
                    <label className="block space-y-1 font-body text-[13px] font-semibold">Section title<input maxLength={200} className={inputClass} value={active.title} onChange={(event) => updateSection(active.id, (section) => ({ ...section, title: event.target.value }))} /></label>
                    <label className="block space-y-1 font-body text-[13px] font-semibold">Section instructions<textarea maxLength={3000} className={inputClass} rows={3} value={active.description} onChange={(event) => updateSection(active.id, (section) => ({ ...section, description: event.target.value }))} /></label>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={index === 0} className={buttonClass} onClick={() => moveSection(active.id, -1)}>Move up</button>
                      <button type="button" disabled={index === form.sections.length - 1} className={buttonClass} onClick={() => moveSection(active.id, 1)}>Move down</button>
                      <button type="button" disabled={form.sections.length >= 50} className={buttonClass} onClick={() => addSection(active)}>Duplicate blank section</button>
                      <button type="button" disabled={form.sections.length === 1} className={buttonClass + " text-red-700"} onClick={() => removeSection(active)}>Remove section</button>
                    </div>
                  </div> : active.description && <p className="mb-5 whitespace-pre-wrap text-sm leading-relaxed text-on-surface-variant">{active.description}</p>}
                  <div className="grid gap-5 sm:grid-cols-2">
                    {active.fields.map((field) => <div key={field.id} className={field.type === "textarea" ? "sm:col-span-2" : ""}>
                      {editStructure && <div className="mb-2 flex gap-2"><input aria-label={"Edit field label: " + field.label} maxLength={300} className={inputClass} value={field.label} onChange={(event) => updateSection(active.id, (section) => ({ ...section, fields: section.fields.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item) }))} /><button type="button" className={buttonClass + " text-red-700"} aria-label={"Remove field: " + field.label} onClick={() => { if (field.value && !window.confirm("Remove this field and its response?")) return; updateSection(active.id, (section) => ({ ...section, fields: section.fields.filter((item) => item.id !== field.id) })); }}>Remove</button></div>}
                      <label className="block space-y-1.5 font-body text-[13px]"><span className="font-semibold text-on-surface">{field.label}</span>
                        {field.type === "textarea" ? <textarea maxLength={6000} rows={3} className={inputClass} value={field.value} onChange={(event) => updateSection(active.id, (section) => ({ ...section, fields: section.fields.map((item) => item.id === field.id ? { ...item, value: event.target.value } : item) }))} /> :
                          field.type === "select" ? <select className={selectClass} style={{ backgroundImage: JOB_ESTIMATE_SELECT_CHEVRON }} value={field.value} onChange={(event) => updateSection(active.id, (section) => ({ ...section, fields: section.fields.map((item) => item.id === field.id ? { ...item, value: event.target.value } : item) }))}><option value="">Not answered</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select> :
                          field.type === "date" ? field.label.trim().toLowerCase() === "date of birth"
                            ? <BirthDateFields key={formSessionId + ":" + field.id} value={field.value} disabled={busy} onChange={(value) => updateSection(active.id, (section) => ({ ...section, fields: section.fields.map((item) => item.id === field.id ? { ...item, value } : item) }))} />
                            : <MonthCalendarField selectedIso={field.value} minDate={platformTodayIso()} allowPast disabled={busy} size="comfortable" placeholder="Choose a date" onSelect={(value) => updateSection(active.id, (section) => ({ ...section, fields: section.fields.map((item) => item.id === field.id ? { ...item, value } : item) }))} /> :
                            <input type={field.type} step={field.type === "number" ? "any" : undefined} maxLength={6000} className={inputClass} value={field.value} onChange={(event) => updateSection(active.id, (section) => ({ ...section, fields: section.fields.map((item) => item.id === field.id ? { ...item, value: event.target.value } : item) }))} />}
                      </label>
                    </div>)}
                  </div>
                  {!active.fields.length && <p className="font-body text-[13px] text-on-surface-variant">Add your first question below. An answer box will appear here.</p>}
                  <div className="mt-6 space-y-3 border-t border-outline-variant/50 pt-4">
                    <h3 className="text-sm font-semibold">Add another question</h3><p className="font-body text-[13px] text-on-surface-variant">Write the question, choose how it should be answered, then click Add question.</p>
                    <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
                      <label><span className="mb-1 block text-sm font-medium">Question</span><input maxLength={300} className={inputClass} placeholder="For example: Who should we contact?" value={newLabel} onChange={(event) => setNewLabel(event.target.value)} /></label>
                      <label><span className="mb-1 block text-sm font-medium">Answer format</span><select className={selectClass} style={{ backgroundImage: JOB_ESTIMATE_SELECT_CHEVRON }} value={newType} onChange={(event) => setNewType(event.target.value as FieldType)}>{FIELD_TYPES.map((type) => <option key={type} value={type}>{({ text: "Short answer", textarea: "Long answer", date: "Date", email: "Email", tel: "Phone", number: "Number", select: "Dropdown" })[type]}</option>)}</select></label>
                      <button type="button" className={buttonClass} disabled={!newLabel.trim() || active.fields.length >= 80 || totalFields >= 600} onClick={addField}>Add question</button>
                    </div>
                    {newType === "select" && <label className="block space-y-1 font-body text-[13px] font-semibold">Choices separated by commas<input className={inputClass} placeholder="Yes, No, N/A" value={newOptions} onChange={(event) => setNewOptions(event.target.value)} /></label>}
                  </div>
                  <div className="mt-6 flex justify-between gap-2"><button type="button" className={buttonClass} disabled={index === 0} onClick={() => setActiveId(form.sections[index - 1].id)}>Previous section</button><button type="button" className={buttonClass} disabled={index === form.sections.length - 1} onClick={() => setActiveId(form.sections[index + 1].id)}>Next section</button></div>
                </section>}
              </div>
            </fieldset>
          </form>
        )}
        </div>
      </div>
    </div>
  );
}
