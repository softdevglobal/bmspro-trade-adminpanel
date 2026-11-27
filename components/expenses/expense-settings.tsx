"use client";

import { ActionButton } from "@/components/expenses/expense-drawer";
import { useAuth } from "@/lib/auth/auth-context";
import { expenseRequest, type ExpenseOptions } from "@/lib/expenses/client";
import { MAX_VEHICLES, type ExpenseSettings, type ExpenseVehicle } from "@/lib/expenses/types";
import { useState } from "react";

const INPUT_CLASS =
  "h-10 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 font-body text-[14px] text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary";

type VehicleDraft = ExpenseVehicle & { key: string };

export function ExpenseSettingsPanel({
  options,
  onSaved,
}: {
  options: ExpenseOptions;
  onSaved: (settings: ExpenseSettings) => void;
}) {
  const { user } = useAuth();
  const initial = options.settings;
  const [limit, setLimit] = useState(initial.spendingLimitAud != null ? String(initial.spendingLimitAud) : "");
  const [accountantEmail, setAccountantEmail] = useState(initial.accountantEmail ?? "");
  const [weeklyReport, setWeeklyReport] = useState(initial.weeklyReport);
  const [monthlyReport, setMonthlyReport] = useState(initial.monthlyReport);
  const [vehicles, setVehicles] = useState<VehicleDraft[]>(
    initial.vehicles.map((vehicle) => ({ ...vehicle, key: vehicle.id })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function updateVehicle(key: string, patch: Partial<ExpenseVehicle>) {
    setVehicles((current) => current.map((vehicle) => (vehicle.key === key ? { ...vehicle, ...patch } : vehicle)));
    setNotice(null);
  }

  async function save() {
    if (!user) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await expenseRequest<{ settings: ExpenseSettings }>(user, "/api/expenses/settings", {
        method: "PATCH",
        body: JSON.stringify({
          spendingLimitAud: limit.trim() ? Number(limit) : null,
          accountantEmail: accountantEmail.trim() || null,
          weeklyReport,
          monthlyReport,
          vehicles: vehicles
            .filter((vehicle) => vehicle.name.trim())
            .map(({ id, name, rego, staffUid }) => ({ id, name, rego, staffUid })),
        }),
      });
      onSaved(result.settings);
      setVehicles(result.settings.vehicles.map((vehicle) => ({ ...vehicle, key: vehicle.id })));
      setNotice("Expense settings saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <section className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-5">
        <h3 className="font-display text-[16px] font-semibold text-on-surface">Approval limit</h3>
        <p className="mt-1 font-body text-[13px] text-on-surface-variant">
          Expenses above this amount are flagged and you get a notification to approve or reject them. Leave it empty for no limit.
        </p>
        <div className="mt-3 flex max-w-xs items-center gap-2">
          <span className="font-body text-[14px] font-semibold text-on-surface-variant">$</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={limit}
            placeholder="No limit"
            onChange={(event) => {
              setLimit(event.target.value);
              setNotice(null);
            }}
            className={INPUT_CLASS}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-5">
        <h3 className="font-display text-[16px] font-semibold text-on-surface">Reports</h3>
        <p className="mt-1 font-body text-[13px] text-on-surface-variant">
          Sophie emails a summary and a spreadsheet of every expense to you, and to your accountant if you add their email.
        </p>
        <div className="mt-3 space-y-3">
          <label className="block max-w-md">
            <span className="mb-1 block font-body text-[12px] font-semibold text-on-surface-variant">Accountant email (optional)</span>
            <input
              type="email"
              value={accountantEmail}
              placeholder="accounts@example.com.au"
              onChange={(event) => {
                setAccountantEmail(event.target.value);
                setNotice(null);
              }}
              className={INPUT_CLASS}
            />
          </label>
          <Toggle label="Weekly report, every Monday" checked={weeklyReport} onChange={setWeeklyReport} />
          <Toggle label="Monthly report, on the 1st" checked={monthlyReport} onChange={setMonthlyReport} />
        </div>
      </section>

      <section className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-5">
        <h3 className="font-display text-[16px] font-semibold text-on-surface">Vehicles</h3>
        <p className="mt-1 font-body text-[13px] text-on-surface-variant">
          Fuel, parking and vehicle receipts are linked to the vehicle the team member usually drives, or to the rego Sophie reads on the receipt.
        </p>
        <div className="mt-3 space-y-2">
          {vehicles.map((vehicle) => (
            <div key={vehicle.key} className="grid grid-cols-1 gap-2 rounded-xl border border-outline-variant/50 p-2 sm:grid-cols-[1.4fr_0.8fr_1.4fr_auto]">
              <input
                className={INPUT_CLASS}
                placeholder="Name, e.g. Van 2"
                value={vehicle.name}
                onChange={(event) => updateVehicle(vehicle.key, { name: event.target.value })}
              />
              <input
                className={INPUT_CLASS}
                placeholder="Rego"
                value={vehicle.rego ?? ""}
                onChange={(event) => updateVehicle(vehicle.key, { rego: event.target.value || null })}
              />
              <select
                className={INPUT_CLASS}
                value={vehicle.staffUid ?? ""}
                onChange={(event) => updateVehicle(vehicle.key, { staffUid: event.target.value || null })}
              >
                <option value="">No usual driver</option>
                {options.team.map((member) => (
                  <option key={member.uid} value={member.uid}>
                    {member.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Remove ${vehicle.name || "vehicle"}`}
                onClick={() => setVehicles((current) => current.filter((item) => item.key !== vehicle.key))}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-error hover:bg-error-container/40"
              >
                <span className="material-symbols-outlined text-[20px]">delete</span>
              </button>
            </div>
          ))}
          {vehicles.length < MAX_VEHICLES ? (
            <button
              type="button"
              onClick={() =>
                setVehicles((current) => [
                  ...current,
                  { key: `new-${Date.now()}`, id: "", name: "", rego: null, staffUid: null },
                ])
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-outline-variant px-3 font-body text-[13px] font-semibold text-primary hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add vehicle
            </button>
          ) : null}
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <p className="font-body text-[13px]">
          {error ? <span className="text-error">{error}</span> : notice ? <span className="text-tertiary">{notice}</span> : null}
        </p>
        <ActionButton tone="primary" busy={saving} onClick={() => void save()}>
          Save settings
        </ActionButton>
      </div>
    </div>
  );
}

/** Same switch as the Trade modules settings: the knob sits at a fixed left offset. */
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <span
        aria-hidden
        className={`relative block h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
          checked ? "bg-primary" : "bg-outline-variant/80"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-200 ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
      <span className="font-body text-[14px] text-on-surface">{label}</span>
    </button>
  );
}
