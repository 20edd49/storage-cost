"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { onValue, ref, set } from "firebase/database";
import { PasscodeGate } from "@/components/PasscodeGate";
import { database, isFirebaseConfigured } from "@/lib/firebase";

// ─── Types ──────────────────────────────────────────────────────────────────

type Person = "Eduardo" | "Martha";

type Expense = {
  id: string;
  title: string;
  amount: number;
  paidBy: Person;
  category: string;
  note: string;
  createdAt: string;
};

type RentalInfo = {
  facilityName: string;
  moveInDate: string;
  chargeStartDate: string;
  billingDate: string;
  plannedMoveOutDate: string;
  unitLabel: string;
  note: string;
};

type DashboardPayload = {
  expenses: Expense[];
  rentalInfo: RentalInfo;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "manhattan-mini-storage-v2";
const DASHBOARD_REF = "manhattanMiniStorage/privateSummer2026EduardoMartha/dashboard";

const PEOPLE: Person[] = ["Eduardo", "Martha"];

const CATEGORIES = [
  "Monthly rent",
  "Vehicle rental",
  "Gas",
  "Parking / Tolls",
  "Supplies & boxes",
  "Locks & security",
  "Insurance",
  "Labor / Help",
  "Miscellaneous",
];


function initialRental(): RentalInfo {
  return {
    facilityName: "",
    moveInDate: "",
    chargeStartDate: "",
    billingDate: "",
    plannedMoveOutDate: "",
    unitLabel: "",
    note: "",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmt = (n: number) => usd.format(n);

const shortDate = (s: string) => {
  if (!s) return "—";
  const d = new Date(s + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function buildCalendar(anchor: string) {
  const focus = anchor ? new Date(anchor + "T12:00:00") : new Date();
  const year = focus.getFullYear();
  const month = focus.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const offset = (firstDay.getDay() + 6) % 7;
  const cells: { iso: string; day: number; inMonth: boolean }[] = [];

  for (let i = 0; i < offset; i++) {
    const d = new Date(year, month, i - offset + 1);
    cells.push({ iso: d.toISOString().split("T")[0], day: d.getDate(), inMonth: false });
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dt = new Date(year, month, d);
    cells.push({ iso: dt.toISOString().split("T")[0], day: d, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const dt = new Date(year, month + 1, cells.length - (offset + lastDay.getDate()) + 1);
    cells.push({ iso: dt.toISOString().split("T")[0], day: dt.getDate(), inMonth: false });
  }

  return {
    label: focus.toLocaleString("en-US", { month: "long", year: "numeric" }),
    cells,
  };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function GlassPanel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-3xl border ${className}`}
      style={{
        background: "rgba(12,20,36,0.72)",
        borderColor: "rgba(255,255,255,0.08)",
        backdropFilter: "blur(24px)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {children}
    </div>
  );
}

function PanelHeader({ eyebrow, title, badge }: { eyebrow: string; title: string; badge?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5">
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase mb-1" style={{ color: "#22d3ee" }}>
          {eyebrow}
        </p>
        <h2 className="text-lg font-bold text-white m-0">{title}</h2>
      </div>
      {badge && (
        <span
          className="mt-1 rounded-full px-3 py-1 text-xs font-medium shrink-0"
          style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.2)" }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function InputField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-medium" style={{ color: "#94a3b8" }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  padding: "10px 14px",
  color: "white",
  fontSize: "0.875rem",
  outline: "none",
  width: "100%",
};

// ─── Main ────────────────────────────────────────────────────────────────────

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [rental, setRental] = useState<RentalInfo>(initialRental);
  const todayIso = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ title: "", amount: "", paidBy: "Eduardo" as Person, category: "Monthly rent", note: "", date: todayIso });
  const [filter, setFilter] = useState<"All" | Person>("All");
  const [activeTab, setActiveTab] = useState<"expenses" | "rental" | "calendar">("expenses");
  const [syncLabel, setSyncLabel] = useState(isFirebaseConfigured ? "Connecting…" : "Local mode");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", amount: "", paidBy: "Eduardo" as Person, category: "Monthly rent", note: "", date: todayIso });
  const [calendarAnchor, setCalendarAnchor] = useState(() => new Date().toISOString().split("T")[0]);

  // Firebase / localStorage sync
  useEffect(() => {
    if (database) {
      const dbRef = ref(database, DASHBOARD_REF);
      return onValue(dbRef, (snap) => {
        const val = snap.val() as DashboardPayload | null;
        if (!val) {
          setSyncLabel("Synced");
          return;
        }
        if (val.expenses) setExpenses(val.expenses);
        if (val.rentalInfo) setRental(val.rentalInfo);
        setSyncLabel("Synced");
      });
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const p = JSON.parse(raw) as DashboardPayload;
      if (p.expenses?.length) setExpenses(p.expenses);
      if (p.rentalInfo) setRental(p.rentalInfo);
      setSyncLabel("Saved locally");
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  async function persist(nextExpenses: Expense[], nextRental: RentalInfo) {
    if (database) {
      await set(ref(database, DASHBOARD_REF), { expenses: nextExpenses, rentalInfo: nextRental });
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ expenses: nextExpenses, rentalInfo: nextRental }));
      setExpenses(nextExpenses);
      setRental(nextRental);
    }
  }

  // Computed
  const summary = useMemo(() => {
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const paid: Record<Person, number> = { Eduardo: 0, Martha: 0 };
    expenses.forEach((e) => { paid[e.paidBy] += e.amount; });
    const share = total / 2;
    const balE = paid.Eduardo - share;
    return { total, count: expenses.length, share, paid, balE };
  }, [expenses]);

  const balanceText = summary.balE > 0.005
    ? `Martha owes Eduardo ${fmt(summary.balE)}`
    : summary.balE < -0.005
    ? `Eduardo owes Martha ${fmt(Math.abs(summary.balE))}`
    : "Even split";

  const filtered = filter === "All" ? expenses : expenses.filter((e) => e.paidBy === filter);

  const importantDates = useMemo(() => [
    { key: "in", label: "Move in", value: rental.moveInDate, color: "#34d399" },
    { key: "charge", label: "Charges start", value: rental.chargeStartDate, color: "#fbbf24" },
    { key: "out", label: "Move out", value: rental.plannedMoveOutDate, color: "#f87171" },
  ].filter((d) => d.value), [rental]);

  // All 1st-of-month billing dates between chargeStartDate and plannedMoveOutDate
  const billingDates = useMemo(() => {
    if (!rental.chargeStartDate) return [];
    const start = new Date(rental.chargeStartDate + "T12:00:00");
    const end = rental.plannedMoveOutDate ? new Date(rental.plannedMoveOutDate + "T12:00:00") : null;
    const dates: string[] = [];
    // Start from the 1st of the month after (or on) chargeStartDate
    let y = start.getFullYear();
    let m = start.getMonth();
    if (start.getDate() > 1) m += 1;
    while (true) {
      if (m > 11) { y += 1; m = 0; }
      const d = new Date(y, m, 1);
      if (end && d > end) break;
      if (!end && dates.length >= 24) break; // safety cap
      dates.push(d.toISOString().split("T")[0]);
      m += 1;
    }
    return dates;
  }, [rental.chargeStartDate, rental.plannedMoveOutDate]);

  const calendar = useMemo(() => buildCalendar(calendarAnchor), [calendarAnchor]);

  async function handleAddExpense(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const amt = parseFloat(form.amount);
    if (!form.title.trim() || isNaN(amt) || amt === 0) return;
    const next: Expense = {
      id: crypto.randomUUID(),
      title: form.title.trim(),
      amount: amt,
      paidBy: form.paidBy,
      category: form.category || "Misc",
      note: form.note.trim(),
      createdAt: form.date || todayIso,
    };
    const nextList = [next, ...expenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    setExpenses(nextList);
    await persist(nextList, rental);
    setForm({ title: "", amount: "", paidBy: "Eduardo", category: "Monthly rent", note: "", date: todayIso });
    setIsAdding(false);
  }

  function startEdit(e: Expense) {
    setEditingId(e.id);
    setEditForm({ title: e.title, amount: String(e.amount), paidBy: e.paidBy, category: e.category, note: e.note, date: e.createdAt });
    setIsAdding(false);
  }

  async function handleSaveEdit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!editingId) return;
    const amt = parseFloat(editForm.amount);
    if (!editForm.title.trim() || isNaN(amt) || amt === 0) return;
    const nextList = expenses
      .map((e) => e.id === editingId ? { ...e, title: editForm.title.trim(), amount: amt, paidBy: editForm.paidBy, category: editForm.category, note: editForm.note.trim(), createdAt: editForm.date || todayIso } : e)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    setExpenses(nextList);
    await persist(nextList, rental);
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    const next = expenses.filter((e) => e.id !== id);
    setExpenses(next);
    await persist(next, rental);
  }

  function stepMonth(delta: number) {
    setCalendarAnchor((prev) => {
      const d = new Date(prev + "T12:00:00");
      d.setMonth(d.getMonth() + delta);
      return d.toISOString().split("T")[0];
    });
  }

  async function updateRental<K extends keyof RentalInfo>(k: K, v: RentalInfo[K]) {
    const next = { ...rental, [k]: v };
    setRental(next);
    await persist(expenses, next);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <PasscodeGate>
      <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #080e18 0%, #0c1622 50%, #080e18 100%)" }}>
        {/* ── Header ── */}
        <header className="sticky top-0 z-50 px-4 pt-safe-top" style={{ background: "rgba(8,14,24,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="mx-auto max-w-2xl flex items-center justify-between py-4">
            <div>
              <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#22d3ee" }}>Summer 2026</p>
              <h1 className="text-base font-bold text-white leading-tight">Manhattan Mini Storage</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(34,211,238,0.1)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.2)" }}>
                {syncLabel}
              </span>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-2xl px-4 pb-24">
          {/* ── Hero metrics ── */}
          <div className="mt-5 grid grid-cols-3 gap-3">
            {[
              { label: "Total spend", value: fmt(summary.total), gradient: "from-cyan-400 to-indigo-400" },
              { label: "Per person", value: fmt(summary.share), gradient: "from-emerald-400 to-cyan-400" },
              { label: "Entries", value: String(summary.count), gradient: "from-violet-400 to-pink-400" },
            ].map((m) => (
              <GlassPanel key={m.label} className="p-4 text-center">
                <p className="text-xs mb-1" style={{ color: "#64748b" }}>{m.label}</p>
                <p className={`text-base font-bold bg-gradient-to-r ${m.gradient} bg-clip-text text-transparent`}>{m.value}</p>
              </GlassPanel>
            ))}
          </div>

          {/* ── Balance banner ── */}
          <div className="mt-3 rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.15)" }}>
            <div className="h-2 w-2 rounded-full shrink-0" style={{ background: "#22d3ee", boxShadow: "0 0 8px #22d3ee" }} />
            <p className="text-sm font-medium" style={{ color: "#e2e8f0" }}>{balanceText}</p>
          </div>

          {/* ── Person bar chart ── */}
          <GlassPanel className="mt-3 p-4">
            <div className="flex items-center justify-between mb-3">
              {PEOPLE.map((p) => (
                <div key={p} className="flex-1 text-center">
                  <p className="text-xs font-medium mb-0.5" style={{ color: "#94a3b8" }}>{p}</p>
                  <p className="text-lg font-bold text-white">{fmt(summary.paid[p])}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              {summary.total > 0 && (
                <>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(summary.paid.Eduardo / summary.total) * 100}%`, background: "linear-gradient(90deg, #f472b6, #fb923c)" }}
                  />
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(summary.paid.Martha / summary.total) * 100}%`, background: "linear-gradient(90deg, #22d3ee, #818cf8)" }}
                  />
                </>
              )}
            </div>
            <div className="mt-2 flex justify-between text-xs" style={{ color: "#475569" }}>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-3 rounded-full inline-block" style={{ background: "linear-gradient(90deg, #f472b6, #fb923c)" }} />
                Eduardo
              </span>
              <span className="flex items-center gap-1.5">
                Martha
                <span className="h-1.5 w-3 rounded-full inline-block" style={{ background: "linear-gradient(90deg, #22d3ee, #818cf8)" }} />
              </span>
            </div>
          </GlassPanel>

          {/* ── Tab bar ── */}
          <div className="mt-5 flex gap-2 p-1 rounded-2xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            {(["expenses", "rental", "calendar"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium capitalize transition-all"
                style={activeTab === tab
                  ? { background: "linear-gradient(135deg, #22d3ee22, #818cf822)", color: "white", border: "1px solid rgba(34,211,238,0.25)" }
                  : { color: "#64748b", border: "1px solid transparent" }
                }
              >
                {tab === "expenses" ? "Costs" : tab === "rental" ? "Details" : "Calendar"}
              </button>
            ))}
          </div>

          {/* ── COSTS TAB ── */}
          {activeTab === "expenses" && (
            <div className="mt-4 space-y-3">
              {/* Add button / inline form */}
              {!isAdding ? (
                <button
                  type="button"
                  onClick={() => setIsAdding(true)}
                  className="w-full py-3.5 rounded-2xl text-sm font-semibold transition-all hover:opacity-90 active:scale-95 flex items-center justify-center gap-2"
                  style={{ background: "linear-gradient(135deg, #22d3ee, #818cf8)", color: "white" }}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add expense
                </button>
              ) : (
                <GlassPanel className="p-5">
                  <PanelHeader eyebrow="Add expense" title="Log a new charge" />
                  <form onSubmit={handleAddExpense} className="space-y-3">
                    <InputField label="What was it for?">
                      <input
                        type="text"
                        placeholder="Monthly rent, boxes, lock…"
                        value={form.title}
                        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                        style={inputStyle}
                        autoFocus
                      />
                    </InputField>
                    <div className="grid grid-cols-2 gap-3">
                      <InputField label="Amount (negative = refund)">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          placeholder="0.00"
                          value={form.amount}
                          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                          style={inputStyle}
                        />
                      </InputField>
                      <InputField label="Who paid?">
                        <select
                          value={form.paidBy}
                          onChange={(e) => setForm((f) => ({ ...f, paidBy: e.target.value as Person }))}
                          style={inputStyle}
                        >
                          {PEOPLE.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </InputField>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <InputField label="Date">
                        <input
                          type="date"
                          value={form.date}
                          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                          style={{ ...inputStyle, colorScheme: "dark" }}
                        />
                      </InputField>
                      <InputField label="Category">
                        <select
                          value={form.category}
                          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                          style={inputStyle}
                        >
                          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </InputField>
                    </div>
                    <InputField label="Note (optional)">
                      <input
                        type="text"
                        placeholder="Any detail…"
                        value={form.note}
                        onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                        style={inputStyle}
                      />
                    </InputField>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsAdding(false)}
                        className="flex-1 py-3 rounded-xl text-sm font-medium transition-all"
                        style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="flex-2 flex-1 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
                        style={{ background: "linear-gradient(135deg, #22d3ee, #818cf8)", color: "white" }}
                      >
                        Save
                      </button>
                    </div>
                  </form>
                </GlassPanel>
              )}

              {/* Filter chips */}
              <div className="flex gap-2">
                {(["All", ...PEOPLE] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setFilter(p as "All" | Person)}
                    className="px-4 py-1.5 rounded-full text-xs font-medium transition-all"
                    style={filter === p
                      ? { background: "rgba(34,211,238,0.15)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.3)" }
                      : { background: "rgba(255,255,255,0.04)", color: "#64748b", border: "1px solid rgba(255,255,255,0.06)" }
                    }
                  >
                    {p}
                  </button>
                ))}
              </div>

              {/* Expense list */}
              {filtered.length === 0 ? (
                <GlassPanel className="p-8 text-center">
                  <p className="text-3xl mb-3">📦</p>
                  <p className="text-sm font-medium text-white">No expenses here yet</p>
                  <p className="text-xs mt-1" style={{ color: "#475569" }}>Add the first charge to start tracking</p>
                </GlassPanel>
              ) : (
                <div className="space-y-2">
                  {filtered.map((e) => {
                    const isEd = e.paidBy === "Eduardo";
                    const isRefund = e.amount < 0;
                    const isEditing = editingId === e.id;

                    if (isEditing) {
                      return (
                        <GlassPanel key={e.id} className="p-4">
                          <p className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: "#22d3ee" }}>Edit transaction</p>
                          <form onSubmit={handleSaveEdit} className="space-y-3">
                            <InputField label="What was it for?">
                              <input type="text" value={editForm.title} onChange={(ev) => setEditForm((f) => ({ ...f, title: ev.target.value }))} style={inputStyle} autoFocus />
                            </InputField>
                            <div className="grid grid-cols-2 gap-3">
                              <InputField label="Amount (negative = refund)">
                                <input type="number" inputMode="decimal" step="0.01" value={editForm.amount} onChange={(ev) => setEditForm((f) => ({ ...f, amount: ev.target.value }))} style={inputStyle} />
                              </InputField>
                              <InputField label="Who paid?">
                                <select value={editForm.paidBy} onChange={(ev) => setEditForm((f) => ({ ...f, paidBy: ev.target.value as Person }))} style={inputStyle}>
                                  {PEOPLE.map((p) => <option key={p} value={p}>{p}</option>)}
                                </select>
                              </InputField>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <InputField label="Date">
                                <input type="date" value={editForm.date} onChange={(ev) => setEditForm((f) => ({ ...f, date: ev.target.value }))} style={{ ...inputStyle, colorScheme: "dark" }} />
                              </InputField>
                              <InputField label="Category">
                                <select value={editForm.category} onChange={(ev) => setEditForm((f) => ({ ...f, category: ev.target.value }))} style={inputStyle}>
                                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </InputField>
                            </div>
                            <InputField label="Note (optional)">
                              <input type="text" placeholder="Any detail…" value={editForm.note} onChange={(ev) => setEditForm((f) => ({ ...f, note: ev.target.value }))} style={inputStyle} />
                            </InputField>
                            <div className="flex gap-2 pt-1">
                              <button type="button" onClick={() => setEditingId(null)} className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all" style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
                                Cancel
                              </button>
                              <button type="button" onClick={() => { void handleDelete(e.id); setEditingId(null); }} className="py-2.5 px-4 rounded-xl text-sm font-medium transition-all hover:opacity-80" style={{ background: "rgba(248,113,113,0.12)", color: "#f87171", border: "1px solid rgba(248,113,113,0.2)" }}>
                                Delete
                              </button>
                              <button type="submit" className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90" style={{ background: "linear-gradient(135deg, #22d3ee, #818cf8)", color: "white" }}>
                                Save
                              </button>
                            </div>
                          </form>
                        </GlassPanel>
                      );
                    }

                    return (
                      <GlassPanel key={e.id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 flex-1 min-w-0" onClick={() => startEdit(e)} style={{ cursor: "pointer" }}>
                            <div
                              className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-xs font-bold"
                              style={isRefund
                                ? { background: "rgba(52,211,153,0.15)", color: "#34d399" }
                                : isEd
                                ? { background: "rgba(244,114,182,0.15)", color: "#f472b6" }
                                : { background: "rgba(34,211,238,0.15)", color: "#22d3ee" }
                              }
                            >
                              {isRefund ? "↩" : e.paidBy[0]}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <p className="text-sm font-semibold text-white truncate">{e.title}</p>
                                  {isRefund && (
                                    <span className="shrink-0 text-xs font-semibold rounded-full px-2 py-0.5" style={{ background: "rgba(52,211,153,0.15)", color: "#34d399" }}>
                                      Refund
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm font-bold shrink-0" style={{ color: isRefund ? "#34d399" : "#e2e8f0" }}>
                                  {isRefund ? `−${fmt(Math.abs(e.amount))}` : fmt(e.amount)}
                                </p>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                <span className="text-xs" style={{ color: "#475569" }}>{e.category}</span>
                                <span className="text-xs" style={{ color: isEd ? "#f472b6" : "#22d3ee" }}>{e.paidBy}</span>
                                <span className="text-xs" style={{ color: "#475569" }}>{shortDate(e.createdAt)}</span>
                              </div>
                              {e.note && <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "#64748b" }}>{e.note}</p>}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => startEdit(e)}
                            className="shrink-0 h-7 w-7 rounded-lg flex items-center justify-center transition-all"
                            style={{ color: "#475569" }}
                            aria-label={`Edit ${e.title}`}
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                        </div>
                      </GlassPanel>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── RENTAL TAB ── */}
          {activeTab === "rental" && (
            <GlassPanel className="mt-4 p-5">
              <PanelHeader eyebrow="Rental details" title="Dates, billing & unit" badge="Editable" />
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Facility name" className="col-span-2">
                    <input type="text" value={rental.facilityName} onChange={(e) => void updateRental("facilityName", e.target.value)} style={inputStyle} />
                  </InputField>
                  <InputField label="Unit label">
                    <input type="text" placeholder="Unit 3B" value={rental.unitLabel} onChange={(e) => void updateRental("unitLabel", e.target.value)} style={inputStyle} />
                  </InputField>
                </div>

                <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />

                <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#22d3ee" }}>Key Dates</p>

                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Move in">
                    <input type="date" value={rental.moveInDate} onChange={(e) => void updateRental("moveInDate", e.target.value)} style={{ ...inputStyle, colorScheme: "dark" }} />
                  </InputField>
                  <InputField label="Charges start">
                    <input type="date" value={rental.chargeStartDate} onChange={(e) => void updateRental("chargeStartDate", e.target.value)} style={{ ...inputStyle, colorScheme: "dark" }} />
                  </InputField>
                  <InputField label="Planned move out">
                    <input type="date" value={rental.plannedMoveOutDate} onChange={(e) => void updateRental("plannedMoveOutDate", e.target.value)} style={{ ...inputStyle, colorScheme: "dark" }} />
                  </InputField>
                </div>

                <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />

                {/* Date pill summary */}
                <div className="grid grid-cols-2 gap-2">
                  {importantDates.map((d) => (
                    <div key={d.key} className="rounded-2xl px-4 py-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <p className="text-xs mb-1" style={{ color: "#475569" }}>{d.label}</p>
                      <p className="text-sm font-bold" style={{ color: d.color }}>{shortDate(d.value)}</p>
                    </div>
                  ))}
                </div>

                <InputField label="Notes">
                  <input type="text" placeholder="Gate code, unit details…" value={rental.note} onChange={(e) => void updateRental("note", e.target.value)} style={inputStyle} />
                </InputField>
              </div>
            </GlassPanel>
          )}

          {/* ── CALENDAR TAB ── */}
          {activeTab === "calendar" && (
            <div className="mt-4 space-y-3">
              <GlassPanel className="p-5">
                {/* Month nav */}
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <p className="text-xs font-semibold tracking-widest uppercase mb-0.5" style={{ color: "#22d3ee" }}>Calendar</p>
                    <h2 className="text-lg font-bold text-white">{calendar.label}</h2>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => stepMonth(-1)}
                      className="h-9 w-9 rounded-xl flex items-center justify-center transition-all hover:opacity-80"
                      style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCalendarAnchor(new Date().toISOString().split("T")[0])}
                      className="px-3 h-9 rounded-xl text-xs font-medium transition-all hover:opacity-80"
                      style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => stepMonth(1)}
                      className="h-9 w-9 rounded-xl flex items-center justify-center transition-all hover:opacity-80"
                      style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Month grid */}
                <div className="grid grid-cols-7 gap-px rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                  {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                    <div key={d} className="py-2 text-center text-xs font-semibold" style={{ color: "#475569" }}>{d}</div>
                  ))}
                  {calendar.cells.map((cell) => {
                    const match = importantDates.find((d) => d.value === cell.iso);
                    const isBilling = billingDates.includes(cell.iso);
                    const isToday = cell.iso === new Date().toISOString().split("T")[0];
                    const highlight = match ?? (isBilling ? { color: "#22d3ee", label: "Billing" } : null);
                    const dayExpenses = expenses.filter((ex) => ex.createdAt === cell.iso);
                    const edExps = dayExpenses.filter((ex) => ex.paidBy === "Eduardo");
                    const mExps = dayExpenses.filter((ex) => ex.paidBy === "Martha");
                    return (
                      <div
                        key={cell.iso}
                        className="relative flex flex-col items-center py-2 px-1 min-h-[56px]"
                        style={{
                          background: highlight ? `${highlight.color}14` : undefined,
                          border: highlight ? `1px solid ${highlight.color}40` : undefined,
                        }}
                      >
                        <span
                          className="text-xs font-semibold"
                          style={{
                            color: !cell.inMonth ? "#1e293b" : highlight ? highlight.color : isToday ? "#22d3ee" : "#e2e8f0",
                          }}
                        >
                          {cell.day}
                        </span>
                        {isToday && !highlight && (
                          <span className="mt-0.5 h-1 w-1 rounded-full" style={{ background: "#22d3ee" }} />
                        )}
                        {highlight && (
                          <span className="mt-0.5 text-center leading-tight" style={{ color: highlight.color, fontSize: "0.55rem", fontWeight: 700 }}>
                            {highlight.label.split(" ")[0]}
                          </span>
                        )}
                        {dayExpenses.length > 0 && cell.inMonth && (
                          <div className="mt-auto pt-1 flex gap-0.5 justify-center flex-wrap">
                            {edExps.map((ex) => (
                              <span key={ex.id} className="h-1.5 w-1.5 rounded-full" style={{ background: ex.amount < 0 ? "#34d399" : "#f472b6" }} />
                            ))}
                            {mExps.map((ex) => (
                              <span key={ex.id} className="h-1.5 w-1.5 rounded-full" style={{ background: ex.amount < 0 ? "#34d399" : "#22d3ee" }} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Dot legend */}
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {[
                    { color: "#f472b6", label: "Eduardo expense" },
                    { color: "#22d3ee", label: "Martha expense" },
                    { color: "#34d399", label: "Refund" },
                  ].map((l) => (
                    <span key={l.label} className="flex items-center gap-1.5 text-xs" style={{ color: "#64748b" }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.color }} />
                      {l.label}
                    </span>
                  ))}
                </div>
              </GlassPanel>

              {/* Legend */}
              <GlassPanel className="p-4">
                <p className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: "#22d3ee" }}>Key dates</p>
                <div className="space-y-2.5">
                  {importantDates.map((d) => (
                    <div key={d.key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: d.color, boxShadow: `0 0 8px ${d.color}` }} />
                        <span className="text-sm" style={{ color: "#94a3b8" }}>{d.label}</span>
                      </div>
                      <span className="text-sm font-semibold" style={{ color: d.color }}>{shortDate(d.value)}</span>
                    </div>
                  ))}
                  {billingDates.length > 0 && (
                    <>
                      <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: "#22d3ee", boxShadow: "0 0 8px #22d3ee" }} />
                          <span className="text-sm" style={{ color: "#94a3b8" }}>Billing (monthly)</span>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5 max-w-[60%]">
                          {billingDates.map((iso) => (
                            <span key={iso} className="text-xs font-semibold rounded-full px-2 py-0.5" style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee" }}>
                              {shortDate(iso)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </GlassPanel>

              {/* Days left */}
              {rental.plannedMoveOutDate && (() => {
                const out = new Date(rental.plannedMoveOutDate + "T12:00:00");
                const today = new Date();
                today.setHours(12, 0, 0, 0);
                const days = Math.ceil((out.getTime() - today.getTime()) / 86400000);
                return days > 0 ? (
                  <div className="rounded-2xl px-5 py-4 flex items-center gap-4" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
                    <span className="text-3xl font-bold" style={{ color: "#f87171" }}>{days}</span>
                    <div>
                      <p className="text-sm font-semibold text-white">days until move out</p>
                      <p className="text-xs" style={{ color: "#64748b" }}>{shortDate(rental.plannedMoveOutDate)}</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl px-5 py-4" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)" }}>
                    <p className="text-sm font-semibold" style={{ color: "#34d399" }}>Move out date has passed</p>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </PasscodeGate>
  );
}
