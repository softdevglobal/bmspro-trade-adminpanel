"use client";

import { DashboardShell } from "@/components/dashboard-shell";
import { useState } from "react";

type BookingCard = {
  id: string;
  customer: string;
  contact: string;
  service: string;
  serviceIcon: string;
  badge: { label: string; icon: string; className: string };
  footer: {
    type: "unassigned" | "staff" | "time" | "schedule";
    label: string;
    className?: string;
  };
  alert?: string;
  assignment?: { type: string; label: string; icon: string };
};

type KanbanColumn = {
  id: string;
  title: string;
  count: number;
  dotClass: string;
  cards: BookingCard[];
  empty?: boolean;
  archived?: boolean;
};

const FILTERS = ["All", "Today", "Unassigned", "Needs Review", "Done"] as const;

const COLUMNS: KanbanColumn[] = [
  {
    id: "new",
    title: "New",
    count: 2,
    dotClass: "bg-primary",
    cards: [
      {
        id: "b1",
        customer: "Alex Thompson",
        contact: "0412 888 999 • Surry Hills",
        service: "HVAC Maintenance",
        serviceIcon: "construction",
        badge: {
          label: "NEW",
          icon: "copy_all",
          className: "bg-primary/10 text-primary",
        },
        footer: { type: "unassigned", label: "Unassigned" },
      },
      {
        id: "b2",
        customer: "Sarah Jenkins",
        contact: "0400 111 222 • Newtown",
        service: "Electrical Fault",
        serviceIcon: "bolt",
        badge: {
          label: "NEW",
          icon: "copy_all",
          className: "bg-primary/10 text-primary",
        },
        footer: { type: "staff", label: "Staff" },
      },
    ],
  },
  {
    id: "review",
    title: "Needs Review",
    count: 1,
    dotClass: "bg-tertiary-container",
    cards: [
      {
        id: "b3",
        customer: "Marcus Wright",
        contact: "0455 333 444 • Bondi Junction",
        service: "Pipe Leakage Repair",
        serviceIcon: "plumbing",
        badge: {
          label: "REVIEW",
          icon: "report",
          className: "bg-tertiary-container/30 text-tertiary",
        },
        alert: "No staff, contractor or partner assigned.",
        footer: { type: "time", label: "14:30 PM" },
      },
    ],
  },
  {
    id: "unassigned",
    title: "Unassigned",
    count: 0,
    dotClass: "bg-outline",
    cards: [],
    empty: true,
  },
  {
    id: "confirmed",
    title: "Confirmed",
    count: 1,
    dotClass: "bg-primary-container",
    cards: [
      {
        id: "b4",
        customer: "Emily Davis",
        contact: "0422 666 777 • Pyrmont",
        service: "Lobby Renovation",
        serviceIcon: "apartment",
        badge: {
          label: "CONFIRMED",
          icon: "check_circle",
          className: "bg-primary-container/20 text-primary",
        },
        assignment: {
          type: "PARTNER",
          label: "Assigned to Partner",
          icon: "business",
        },
        footer: { type: "schedule", label: "Tomorrow, 09:00 AM" },
      },
    ],
  },
  {
    id: "assigned",
    title: "Assigned",
    count: 1,
    dotClass: "bg-secondary",
    cards: [
      {
        id: "b5",
        customer: "Corporate Plaza 1",
        contact: "02 9123 4567 • North Sydney",
        service: "Access Control System",
        serviceIcon: "security",
        badge: {
          label: "ASSIGNED",
          icon: "person_add",
          className: "bg-secondary-container/40 text-on-secondary-container",
        },
        assignment: {
          type: "CONTRACTOR",
          label: "Assigned to Contractor",
          icon: "handyman",
        },
        footer: { type: "schedule", label: "Today, 11:45 AM" },
      },
    ],
  },
  {
    id: "done",
    title: "Done",
    count: 3,
    dotClass: "bg-on-surface-variant",
    cards: [],
    archived: true,
  },
];

const LIST_BOOKINGS = COLUMNS.flatMap((column) =>
  column.cards.map((card) => ({
    ...card,
    column: column.title,
  })),
);

function BookingCardFooter({ footer }: { footer: BookingCard["footer"] }) {
  if (footer.type === "unassigned") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-tertiary-container/30 bg-tertiary-container/10 px-3 py-1 text-tertiary">
        <span className="material-symbols-outlined text-[18px]">warning</span>
        <span className="text-[12px] font-bold">{footer.label}</span>
      </div>
    );
  }

  if (footer.type === "staff") {
    return (
      <div className="flex items-center gap-1 rounded-lg bg-surface-container-high px-3 py-1 text-[10px] font-black uppercase text-on-surface-variant">
        {footer.label}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {footer.type === "time" && (
        <span className="material-symbols-outlined text-[18px] text-outline-variant">
          schedule
        </span>
      )}
      <span className="text-[12px] font-bold text-outline">{footer.label}</span>
    </div>
  );
}

function KanbanCard({ card }: { card: BookingCard }) {
  return (
    <div className="group cursor-grab rounded-xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md active:cursor-grabbing">
      <div className="mb-3 flex items-start justify-between">
        <span
          className={`flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-bold ${card.badge.className}`}
        >
          <span className="material-symbols-outlined text-[14px]">
            {card.badge.icon}
          </span>
          {card.badge.label}
        </span>
        {card.id === "b1" && (
          <span className="material-symbols-outlined text-outline-variant transition-colors group-hover:text-primary">
            description
          </span>
        )}
      </div>

      <h4 className="mb-1 font-body text-body-lg font-bold text-on-surface">
        {card.customer}
      </h4>
      <p className="mb-4 font-body text-label-bold text-label-bold text-outline">
        {card.contact}
      </p>

      <div className="mb-4 flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-outline">
          {card.serviceIcon}
        </span>
        <span className="font-body text-body-md text-on-surface-variant">
          {card.service}
        </span>
      </div>

      {card.alert && (
        <div className="mb-4 rounded-lg border border-tertiary-container/30 bg-tertiary-container/10 p-3">
          <p className="text-[12px] leading-tight text-tertiary">{card.alert}</p>
        </div>
      )}

      {card.assignment && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-outline-variant bg-surface-container-low p-3">
          <span className="material-symbols-outlined text-primary-container">
            {card.assignment.icon}
          </span>
          <div className="flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-tighter text-on-surface-variant">
              {card.assignment.type}
            </span>
            <span className="text-[13px] font-bold text-on-surface">
              {card.assignment.label}
            </span>
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between border-t border-outline-variant/50 pt-4">
        <BookingCardFooter footer={card.footer} />
        <button
          type="button"
          className="text-[14px] font-bold text-primary hover:underline"
        >
          Open
        </button>
      </div>
    </div>
  );
}

export default function BookingsPage() {
  const [activeFilter, setActiveFilter] = useState<(typeof FILTERS)[number]>(
    "All",
  );
  const [viewMode, setViewMode] = useState<"board" | "list">("board");

  return (
    <DashboardShell
      title="Bookings"
      subtitle="All bookings, assignments and job statuses."
    >
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="flex items-center gap-3 sm:ml-auto">
          <button
            type="button"
            className="flex items-center gap-2 rounded-xl border border-outline-variant/50 bg-surface-container-high px-5 py-2.5 font-body text-label-bold text-label-bold text-on-surface-variant transition-colors hover:bg-surface-container-highest"
          >
            <span className="material-symbols-outlined text-[20px]">
              calendar_month
            </span>
            View Calendar
          </button>
          <div className="flex rounded-xl border border-outline-variant/30 bg-surface-container p-1">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`rounded-lg px-4 py-1.5 font-body text-label-bold text-label-bold transition-all ${
                viewMode === "list"
                  ? "bg-surface-container-lowest text-primary shadow-sm"
                  : "text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode("board")}
              className={`rounded-lg px-4 py-1.5 font-body text-label-bold text-label-bold transition-all ${
                viewMode === "board"
                  ? "bg-surface-container-lowest text-primary shadow-sm"
                  : "text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              Board
            </button>
          </div>
        </div>
      </div>

      <div className="custom-scrollbar flex gap-2 overflow-x-auto pb-4">
        {FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setActiveFilter(filter)}
            className={`shrink-0 rounded-full px-6 py-2 font-body text-label-bold text-label-bold transition-all ${
              activeFilter === filter
                ? "bg-primary text-on-primary shadow-sm"
                : "border border-outline-variant/50 bg-surface-container-lowest text-on-surface-variant hover:border-primary/50 hover:text-primary"
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {viewMode === "board" ? (
        <div className="-mx-gutter mt-4 flex-1 overflow-x-auto px-gutter custom-scrollbar">
          <div className="flex min-h-[600px] gap-6 pb-8">
            {COLUMNS.map((column) => (
              <div
                key={column.id}
                className="flex min-w-[320px] max-w-[320px] flex-col gap-4"
              >
                <div className="mb-2 flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${column.dotClass}`}
                    />
                    <h3 className="font-body text-label-bold text-label-bold font-bold uppercase tracking-wider text-on-surface">
                      {column.title} ({column.count})
                    </h3>
                  </div>
                  {column.id === "new" && (
                    <span className="material-symbols-outlined cursor-pointer text-[20px] text-outline">
                      more_vert
                    </span>
                  )}
                </div>

                {column.empty && (
                  <div className="flex flex-1 items-center justify-center rounded-2xl border-2 border-dashed border-outline-variant/30 bg-surface-container-lowest/50">
                    <p className="font-body text-label-bold text-label-bold text-outline-variant">
                      Drop cards here
                    </p>
                  </div>
                )}

                {column.archived && (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-outline-variant bg-surface-container-low p-5 text-center opacity-60">
                    <span className="material-symbols-outlined mb-2 text-[32px] text-outline">
                      task_alt
                    </span>
                    <p className="text-[12px] font-bold text-outline">
                      Older completed jobs are archived
                    </p>
                  </div>
                )}

                {column.cards.map((card) => (
                  <KanbanCard key={card.id} card={card} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
          <div className="hidden grid-cols-[1fr_1fr_1fr_auto] gap-4 border-b border-outline-variant px-card-padding py-4 font-body text-label-bold text-label-bold text-on-surface-variant md:grid">
            <span>Customer</span>
            <span>Service</span>
            <span>Status</span>
            <span>Action</span>
          </div>
          <ul className="divide-y divide-outline-variant">
            {LIST_BOOKINGS.map((booking) => (
              <li
                key={booking.id}
                className="flex flex-col gap-3 px-card-padding py-4 md:grid md:grid-cols-[1fr_1fr_1fr_auto] md:items-center"
              >
                <div>
                  <p className="font-body text-body-md font-semibold text-on-surface">
                    {booking.customer}
                  </p>
                  <p className="font-body text-[13px] text-on-surface-variant">
                    {booking.contact}
                  </p>
                </div>
                <p className="font-body text-body-md text-on-surface">
                  {booking.service}
                </p>
                <span className="inline-flex w-fit rounded-full bg-surface-container-high px-3 py-1 text-[12px] font-semibold text-on-surface-variant">
                  {booking.column}
                </span>
                <button
                  type="button"
                  className="text-[14px] font-bold text-primary hover:underline"
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashboardShell>
  );
}
