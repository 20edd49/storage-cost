"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { onValue, ref, set } from "firebase/database";
import { PasscodeGate } from "@/components/PasscodeGate";
import { database, isFirebaseConfigured } from "@/lib/firebase";

// ─── Types ───────────────────────────────────────────────────────────────────

type Expense = {
  id: string;
  title: string;
  amount: number;
  paidBy: string;
  category: string;
  note: string;
  createdAt: string;
  splitBetween?: string[];
  splitWeights?: Record<string, number>;
  dueNow?: boolean;
  isPayment?: boolean;
};

type RentalInfo = {
  facilityName: string;
  moveInDate: string;
  chargeStartDate: string;
  billingDate: string;
  plannedMoveOutDate: string;
  unitLabel: string;
  note: string;
  thirdPerson: string;
  contributionAdjustments?: Record<string, number>;
};

type DashboardPayload = {
  expenses: Expense[];
  rentalInfo: RentalInfo;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "manhattan-mini-storage-v2";
const DASHBOARD_REF = "manhattanMiniStorage/privateSummer2026EduardoMartha/dashboard";
const CORE_PEOPLE = ["Eduardo", "Martha"];

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

const PALETTE = [
  { gradient: "linear-gradient(90deg,#f472b6,#fb923c)", dot: "#f472b6", bg: "rgba(244,114,182,0.15)", text: "#f472b6" },
  { gradient: "linear-gradient(90deg,#22d3ee,#818cf8)", dot: "#22d3ee", bg: "rgba(34,211,238,0.15)", text: "#22d3ee" },
  { gradient: "linear-gradient(90deg,#34d399,#a78bfa)", dot: "#a78bfa", bg: "rgba(167,139,250,0.15)", text: "#a78bfa" },
];

function paletteFor(name: string, allPeople: string[]) {
  const idx = allPeople.indexOf(name);
  return PALETTE[idx >= 0 && idx < PALETTE.length ? idx : 0];
}

function initialRental(): RentalInfo {
  return {
    facilityName: "",
    moveInDate: "",
    chargeStartDate: "",
    billingDate: "",
    plannedMoveOutDate: "",
    unitLabel: "",
    note: "",
    thirdPerson: "",
    contributionAdjustments: {},
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

function isExpenseDueNow(e: Expense, todayIso: string): boolean {
  if (e.dueNow !== undefined) return e.dueNow;
  return e.createdAt <= todayIso;
}

function effectiveSplit(e: Expense): string[] {
  return (e.splitBetween?.length ?? 0) >= 1 ? e.splitBetween! : [...CORE_PEOPLE];
}

function sanitizeContributionAdjustments(adjustments?: Record<string, number>): Record<string, number> {
  if (!adjustments) return {};
  return Object.fromEntries(
    Object.entries(adjustments).map(([person, amount]) => [person, Number.isFinite(amount) ? amount : 0])
  );
}

function hasCustomWeights(e: Expense): boolean {
  return !!e.splitWeights && Object.keys(e.splitWeights).length > 0;
}

function personShare(e: Expense, person: string): number {
  const split = effectiveSplit(e);
  if (!split.includes(person)) return 0;
  if (!hasCustomWeights(e)) return e.amount / split.length;
  const w = e.splitWeights!;
  const totalW = split.reduce((s, p) => s + (w[p] ?? 1), 0);
  if (totalW === 0) return e.amount / split.length;
  return e.amount * ((w[person] ?? 1) / totalW);
}

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

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function InputField({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
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

const smallInputStyle = {
  ...inputStyle,
  padding: "6px 10px",
  fontSize: "0.8rem",
  width: "72px",
  textAlign: "right" as const,
};

// ─── Split picker ─────────────────────────────────────────────────────────────

function SplitPicker({
  allPeople,
  splitBetween,
  splitWeights,
  amount,
  onChange,
}: {
  allPeople: string[];
  splitBetween: string[];
  splitWeights: Record<string, number>;
  amount: string;
  onChange: (splitBetween: string[], splitWeights: Record<string, number>) => void;
}) {
  const [customMode, setCustomMode] = useState(Object.keys(splitWeights).length > 0);
  const hasWeights = Object.keys(splitWeights).length > 0;
  const amt = parseFloat(amount) || 0;

  function togglePerson(person: string) {
    const next = splitBetween.includes(person)
      ? splitBetween.filter((p) => p !== person)
      : [...splitBetween, person];
    if (next.length < 1) return;
    const nextWeights = { ...splitWeights };
    delete nextWeights[person];
    onChange(next, nextWeights);
  }

  function setWeight(person: string, val: string) {
    const n = parseFloat(val);
    onChange(splitBetween, { ...splitWeights, [person]: isNaN(n) ? 1 : Math.max(0, n) });
  }

  function toggleCustomMode() {
    if (customMode) {
      setCustomMode(false);
      onChange(splitBetween, {});
    } else {
      const seed: Record<string, number> = {};
      splitBetween.forEach((p) => { seed[p] = 1; });
      setCustomMode(true);
      onChange(splitBetween, seed);
    }
  }

  function preview(person: string): string {
    if (!amt) return fmt(0);
    if (!hasWeights) return fmt(amt / splitBetween.length);
    const totalW = splitBetween.reduce((s, p) => s + (splitWeights[p] ?? 1), 0);
    if (totalW === 0) return fmt(0);
    return fmt(amt * ((splitWeights[person] ?? 1) / totalW));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: "#94a3b8" }}>Split between</span>
        <button
          type="button"
          onClick={toggleCustomMode}
          className="text-xs font-medium px-2.5 py-1 rounded-lg transition-all"
          style={
            customMode
              ? { background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.25)" }
              : { background: "rgba(255,255,255,0.05)", color: "#64748b", border: "1px solid rgba(255,255,255,0.08)" }
          }
        >
          {customMode ? "Custom weights" : "Equal split"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {allPeople.map((p) => {
          const active = splitBetween.includes(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => togglePerson(p)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={
                active
                  ? { background: "rgba(34,211,238,0.15)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.35)" }
                  : { background: "rgba(255,255,255,0.04)", color: "#475569", border: "1px solid rgba(255,255,255,0.08)" }
              }
            >
              {active ? "✓ " : ""}{p}
            </button>
          );
        })}
      </div>

      {customMode && splitBetween.length > 0 && (
        <div className="rounded-2xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-xs" style={{ color: "#475569" }}>Proportional weights (miles, hours, %, etc.)</p>
          {splitBetween.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <span className="flex-1 text-xs font-medium text-white">{p}</span>
              <input
                type="number" min="0" step="any"
                value={splitWeights[p] ?? 1}
                onChange={(ev) => setWeight(p, ev.target.value)}
                style={smallInputStyle}
              />
              {amt > 0 && (
                <span className="text-xs font-semibold w-20 text-right" style={{ color: "#22d3ee" }}>
                  {preview(p)}
                </span>
              )}
            </div>
          ))}
          {amt > 0 && (
            <div className="pt-1 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <p className="text-xs" style={{ color: "#475569" }}>
                {splitBetween.map((p) => `${p}: ${preview(p)}`).join("  ·  ")}
              </p>
            </div>
          )}
        </div>
      )}

      {!customMode && splitBetween.length > 1 && amt > 0 && (
        <p className="text-xs" style={{ color: "#475569" }}>{fmt(amt / splitBetween.length)} each</p>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [todayIso, setTodayIso] = useState("");

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [rental, setRental] = useState<RentalInfo>(initialRental);

  const blankForm = () => ({
    title: "", amount: "", paidBy: "Eduardo", category: "Monthly rent",
    note: "", date: todayIso,
    splitBetween: [...CORE_PEOPLE],
    splitWeights: {} as Record<string, number>,
    dueNow: undefined as boolean | undefined,
  });

  const [form, setForm] = useState(blankForm);
  const [filter, setFilter] = useState<string>("All");
  const [activeTab, setActiveTab] = useState<"expenses" | "rental" | "calendar">("expenses");
  const [syncLabel, setSyncLabel] = useState(isFirebaseConfigured ? "Connecting…" : "Local mode");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(blankForm);
  const [calendarAnchor, setCalendarAnchor] = useState("");
  const [contributionEditorPerson, setContributionEditorPerson] = useState<string | null>(null);
  const [transferFromPerson, setTransferFromPerson] = useState("");
  const [transferDraft, setTransferDraft] = useState("");

  const allPeople = useMemo(
    () => [...CORE_PEOPLE, ...(rental.thirdPerson.trim() ? [rental.thirdPerson.trim()] : [])],
    [rental.thirdPerson]
  );

  const contributionAdjustments = useMemo(
    () => sanitizeContributionAdjustments(rental.contributionAdjustments),
    [rental.contributionAdjustments]
  );

  // Set today's date client-side to avoid SSR/client hydration mismatch
  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    setTodayIso(today);
    setCalendarAnchor(today);
    setForm((f) => ({ ...f, date: today }));
  }, []);

  // Firebase / localStorage sync
  useEffect(() => {
    if (database) {
      const dbRef = ref(database, DASHBOARD_REF);
      return onValue(dbRef, (snap) => {
        const val = snap.val() as DashboardPayload | null;
        if (!val) { setSyncLabel("Synced"); return; }
        if (val.expenses) setExpenses(val.expenses);
        if (val.rentalInfo) setRental({ ...initialRental(), ...val.rentalInfo });
        setSyncLabel("Synced");
      });
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const p = JSON.parse(raw) as DashboardPayload;
      if (p.expenses?.length) setExpenses(p.expenses);
      if (p.rentalInfo) setRental({ ...initialRental(), ...p.rentalInfo });
      setSyncLabel("Saved locally");
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  async function persist(nextExpenses: Expense[], nextRental: RentalInfo) {
    // JSON round-trip strips undefined values that Firebase rejects
    const payload = JSON.parse(JSON.stringify({ expenses: nextExpenses, rentalInfo: nextRental }));
    if (database) {
      await set(ref(database, DASHBOARD_REF), payload);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setExpenses(nextExpenses);
      setRental(nextRental);
    }
  }

  // Computed
  const summary = useMemo(() => {
    function dueNow(e: Expense) {
      return e.dueNow !== undefined ? e.dueNow : e.createdAt <= todayIso;
    }

    const dueExpenses = expenses.filter(dueNow);
    const upcomingExpenses = expenses.filter((e) => !dueNow(e));
    const totalAll = expenses.filter((e) => !e.isPayment).reduce((s, e) => s + e.amount, 0);
    const totalDue = dueExpenses.filter((e) => !e.isPayment).reduce((s, e) => s + e.amount, 0);
    const totalUpcoming = upcomingExpenses.filter((e) => !e.isPayment).reduce((s, e) => s + e.amount, 0);

    const paid: Record<string, number> = Object.fromEntries(allPeople.map((p) => [p, 0]));
    for (const e of expenses) {
      if (!e.isPayment) paid[e.paidBy] = (paid[e.paidBy] ?? 0) + e.amount;
    }

    const adjustedPaid: Record<string, number> = Object.fromEntries(
      allPeople.map((p) => [p, (paid[p] ?? 0) + (contributionAdjustments[p] ?? 0)])
    );

    const shares: Record<string, number> = Object.fromEntries(allPeople.map((p) => [p, 0]));
    for (const e of dueExpenses.filter((ex) => !ex.isPayment)) {
      for (const p of effectiveSplit(e)) {
        shares[p] = (shares[p] ?? 0) + personShare(e, p);
      }
    }

    const nearestUpcoming = [...upcomingExpenses]
      .filter((e) => !e.isPayment)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

    return {
      totalAll, totalDue, totalUpcoming,
      count: expenses.filter((e) => !e.isPayment).length,
      upcomingCount: upcomingExpenses.filter((e) => !e.isPayment).length,
      paid, adjustedPaid, shares, nearestUpcoming,
    };
  }, [expenses, allPeople, contributionAdjustments, todayIso]);

  // Upcoming hero card label + value
  const upcomingCard = useMemo(() => {
    if (summary.upcomingCount === 0) {
      return { label: "Expenses", value: `${summary.count} item${summary.count !== 1 ? "s" : ""}` };
    }
    if (summary.upcomingCount === 1 && summary.nearestUpcoming) {
      return { label: `Due ${shortDate(summary.nearestUpcoming.createdAt)}`, value: fmt(summary.nearestUpcoming.amount) };
    }
    return {
      label: "Upcoming",
      value: `${fmt(summary.totalUpcoming)} · next ${shortDate(summary.nearestUpcoming!.createdAt)}`,
    };
  }, [summary]);

  const filtered = filter === "All" ? expenses : expenses.filter((e) => e.paidBy === filter);

  const importantDates = useMemo(() => [
    { key: "in", label: "Move in", value: rental.moveInDate, color: "#34d399" },
    { key: "charge", label: "Charges start", value: rental.chargeStartDate, color: "#fbbf24" },
    { key: "out", label: "Move out", value: rental.plannedMoveOutDate, color: "#f87171" },
  ].filter((d) => d.value), [rental]);

  const billingDates = useMemo(() => {
    if (!rental.chargeStartDate) return [];
    const start = new Date(rental.chargeStartDate + "T12:00:00");
    const end = rental.plannedMoveOutDate ? new Date(rental.plannedMoveOutDate + "T12:00:00") : null;
    const dates: string[] = [];
    let y = start.getFullYear(), m = start.getMonth();
    if (start.getDate() > 1) m += 1;
    while (true) {
      if (m > 11) { y += 1; m = 0; }
      const d = new Date(y, m, 1);
      if (end && d > end) break;
      if (!end && dates.length >= 24) break;
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
    const date = form.date || todayIso;
    const isFuture = date > todayIso;
    const split = form.splitBetween.length >= 2 ? form.splitBetween : [...CORE_PEOPLE];
    const weights = Object.keys(form.splitWeights).length > 0 ? form.splitWeights : undefined;
    const next: Expense = {
      id: crypto.randomUUID(),
      title: form.title.trim(),
      amount: amt,
      paidBy: form.paidBy,
      category: form.category || "Misc",
      note: form.note.trim(),
      createdAt: date,
      splitBetween: split,
      ...(weights ? { splitWeights: weights } : {}),
      ...(isFuture && form.dueNow !== undefined ? { dueNow: form.dueNow } : {}),
    };
    const nextList = [next, ...expenses].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    setExpenses(nextList);
    await persist(nextList, rental);
    setForm(blankForm());
    setIsAdding(false);
  }

  function startEdit(e: Expense) {
    setEditingId(e.id);
    setEditForm({
      title: e.title,
      amount: String(e.amount),
      paidBy: e.paidBy,
      category: e.category,
      note: e.note,
      date: e.createdAt,
      splitBetween: effectiveSplit(e),
      splitWeights: e.splitWeights ?? {},
      dueNow: e.dueNow,
    });
    setIsAdding(false);
  }

  async function handleSaveEdit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!editingId) return;
    const amt = parseFloat(editForm.amount);
    if (!editForm.title.trim() || isNaN(amt) || amt === 0) return;
    const date = editForm.date || todayIso;
    const isFuture = date > todayIso;
    const split = editForm.splitBetween.length >= 2 ? editForm.splitBetween : [...CORE_PEOPLE];
    const weights = Object.keys(editForm.splitWeights).length > 0 ? editForm.splitWeights : undefined;
    const nextList = expenses
      .map((e) =>
        e.id === editingId
          ? {
              ...e,
              title: editForm.title.trim(),
              amount: amt,
              paidBy: editForm.paidBy,
              category: editForm.category,
              note: editForm.note.trim(),
              createdAt: date,
              splitBetween: split,
              splitWeights: weights,
              dueNow: isFuture ? editForm.dueNow : undefined,
            }
          : e
      )
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

  function openContributionEditor(person: string) {
    const fallback = allPeople.find((p) => p !== person) ?? "";
    setContributionEditorPerson(person);
    setTransferFromPerson(fallback);
    setTransferDraft("");
  }

  function closeContributionEditor() {
    setContributionEditorPerson(null);
    setTransferFromPerson("");
    setTransferDraft("");
  }

  async function saveContributionTransfer() {
    if (!contributionEditorPerson || !transferFromPerson || contributionEditorPerson === transferFromPerson) return;
    const parsed = parseFloat(transferDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const maxTransfer = Math.max(0, summary.adjustedPaid[transferFromPerson] ?? 0);
    const amount = Math.min(parsed, maxTransfer);
    if (amount <= 0) return;
    const nextAdjustments = { ...contributionAdjustments };
    nextAdjustments[contributionEditorPerson] = (nextAdjustments[contributionEditorPerson] ?? 0) + amount;
    nextAdjustments[transferFromPerson] = (nextAdjustments[transferFromPerson] ?? 0) - amount;
    const nextRental = { ...rental, contributionAdjustments: nextAdjustments };
    setRental(nextRental);
    await persist(expenses, nextRental);
    closeContributionEditor();
  }

  const transferPreviewAmount =
    contributionEditorPerson && transferFromPerson
      ? Math.min(
          Math.max(0, Number.isFinite(parseFloat(transferDraft)) ? parseFloat(transferDraft) : 0),
          Math.max(0, summary.adjustedPaid[transferFromPerson] ?? 0)
        )
      : 0;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <PasscodeGate>
      <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #080e18 0%, #0c1622 50%, #080e18 100%)" }}>
        {/* Header */}
        <header className="sticky top-0 z-50 px-4 pt-safe-top" style={{ background: "rgba(8,14,24,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="mx-auto max-w-2xl flex items-center justify-between py-4">
            <div>
              <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#22d3ee" }}>Summer 2026</p>
              <h1 className="text-base font-bold text-white leading-tight">Manhattan Mini Storage</h1>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(34,211,238,0.1)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.2)" }}>
              {syncLabel}
            </span>
          </div>
        </header>

        <div className="mx-auto max-w-2xl px-4 pb-24">
          {/* Hero metrics — 2 cards */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <GlassPanel className="p-4 text-center">
              <p className="text-xs mb-1" style={{ color: "#64748b" }}>Current total</p>
              <p className="text-base font-bold bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">{fmt(summary.totalDue)}</p>
            </GlassPanel>
            <GlassPanel className="p-4 text-center">
              <p className="text-xs mb-1" style={{ color: "#64748b" }}>{upcomingCard.label}</p>
              <p className="text-base font-bold bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">{upcomingCard.value}</p>
              {summary.upcomingCount > 0 && (
                <p className="text-xs mt-1" style={{ color: "#475569" }}>not in split yet</p>
              )}
            </GlassPanel>
          </div>

          {/* Shares */}
          <div className="mt-3 flex gap-3">
            {allPeople.map((p) => {
              const pal = paletteFor(p, allPeople);
              return (
                <div key={p} className="flex-1 rounded-2xl px-4 py-3 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <p className="text-xs mb-1" style={{ color: "#64748b" }}>{p}&apos;s share</p>
                  <p className="text-base font-bold" style={{ color: pal.text }}>{fmt(summary.shares[p] ?? 0)}</p>
                </div>
              );
            })}
          </div>

          {/* Bar chart */}
          <GlassPanel className="mt-3 p-4">
            <div className="flex items-center justify-between mb-3">
              {allPeople.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => openContributionEditor(p)}
                  className="flex-1 text-center"
                  style={{ background: "transparent", border: 0, padding: 0 }}
                >
                  <p className="text-xs font-medium mb-0.5" style={{ color: "#94a3b8" }}>{p}</p>
                  <p className="text-lg font-bold text-white">{fmt(summary.adjustedPaid[p] ?? 0)}</p>
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              {summary.totalAll > 0 && allPeople.map((p) => {
                const pal = paletteFor(p, allPeople);
                const pct = ((summary.adjustedPaid[p] ?? 0) / summary.totalAll) * 100;
                return pct > 0 ? (
                  <div key={p} className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pal.gradient }} />
                ) : null;
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {allPeople.map((p) => {
                const pal = paletteFor(p, allPeople);
                return (
                  <span key={p} className="flex items-center gap-1.5 text-xs" style={{ color: "#475569" }}>
                    <span className="h-1.5 w-3 rounded-full inline-block" style={{ background: pal.gradient }} />
                    {p}
                  </span>
                );
              })}
            </div>
          </GlassPanel>

          {contributionEditorPerson && (
            <GlassPanel className="mt-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold tracking-widest uppercase mb-1" style={{ color: "#22d3ee" }}>Contribution transfer</p>
                  <h3 className="text-base font-bold text-white">{contributionEditorPerson}</h3>
                </div>
                <button
                  type="button"
                  onClick={closeContributionEditor}
                  className="h-8 w-8 rounded-xl text-sm"
                  style={{ background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}
                  aria-label="Close contribution editor"
                >
                  ×
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="text-[0.7rem]" style={{ color: "#64748b" }}>Currently shown for {contributionEditorPerson}</p>
                  <p className="text-sm font-semibold text-white">{fmt(summary.adjustedPaid[contributionEditorPerson] ?? 0)}</p>
                </div>
                <div className="rounded-2xl px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="text-[0.7rem]" style={{ color: "#64748b" }}>Original contribution</p>
                  <p className="text-sm font-semibold text-white">{fmt(summary.paid[contributionEditorPerson] ?? 0)}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <InputField label={`Increase ${contributionEditorPerson}'s contribution using`}>
                  <select value={transferFromPerson} onChange={(e) => setTransferFromPerson(e.target.value)} style={inputStyle}>
                    {allPeople.filter((p) => p !== contributionEditorPerson).map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </InputField>
                <InputField label="Amount to transfer">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={transferDraft}
                    onChange={(e) => setTransferDraft(e.target.value)}
                    style={inputStyle}
                    autoFocus
                  />
                </InputField>
              </div>
              {transferFromPerson && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <p className="text-[0.7rem]" style={{ color: "#64748b" }}>{transferFromPerson} after transfer</p>
                    <p className="text-sm font-semibold text-white">
                      {fmt(Math.max(0, (summary.adjustedPaid[transferFromPerson] ?? 0) - transferPreviewAmount))}
                    </p>
                  </div>
                  <div className="rounded-2xl px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <p className="text-[0.7rem]" style={{ color: "#64748b" }}>{contributionEditorPerson} after transfer</p>
                    <p className="text-sm font-semibold text-white">
                      {fmt((summary.adjustedPaid[contributionEditorPerson] ?? 0) + transferPreviewAmount)}
                    </p>
                  </div>
                </div>
              )}
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={closeContributionEditor}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveContributionTransfer()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #22d3ee, #818cf8)", color: "white" }}
                >
                  Save internal transfer
                </button>
              </div>
            </GlassPanel>
          )}

          {/* Tab bar */}
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
              {/* Action buttons */}
              {!isAdding && !editingId && (
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
              )}

              {/* Add expense form */}
              {isAdding && (
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
                          type="number" inputMode="decimal" step="0.01" placeholder="0.00"
                          value={form.amount}
                          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                          style={inputStyle}
                        />
                      </InputField>
                      <InputField label="Who paid?">
                        <select value={form.paidBy} onChange={(e) => setForm((f) => ({ ...f, paidBy: e.target.value }))} style={inputStyle}>
                          {allPeople.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </InputField>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <InputField label="Date">
                        <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value, dueNow: undefined }))} style={{ ...inputStyle, colorScheme: "dark" }} />
                      </InputField>
                      <InputField label="Category">
                        <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} style={inputStyle}>
                          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </InputField>
                    </div>
                    <SplitPicker
                      allPeople={allPeople}
                      splitBetween={form.splitBetween}
                      splitWeights={form.splitWeights}
                      amount={form.amount}
                      onChange={(sb, sw) => setForm((f) => ({ ...f, splitBetween: sb, splitWeights: sw }))}
                    />
                    {form.date > todayIso && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium" style={{ color: "#94a3b8" }}>Due status</span>
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, dueNow: f.dueNow === true ? undefined : true }))}
                          className="self-start px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                          style={
                            form.dueNow === true
                              ? { background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.35)" }
                              : { background: "rgba(251,191,36,0.1)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.25)" }
                          }
                        >
                          {form.dueNow === true ? "✓ Due now" : `Not due until ${shortDate(form.date)}`}
                        </button>
                      </div>
                    )}
                    <InputField label="Note (optional)">
                      <input type="text" placeholder="Any detail…" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} style={inputStyle} />
                    </InputField>
                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={() => setIsAdding(false)} className="flex-1 py-3 rounded-xl text-sm font-medium transition-all" style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.08)" }}>
                        Cancel
                      </button>
                      <button type="submit" className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90" style={{ background: "linear-gradient(135deg, #22d3ee, #818cf8)", color: "white" }}>
                        Save
                      </button>
                    </div>
                  </form>
                </GlassPanel>
              )}

              {/* Filter chips */}
              <div className="flex flex-wrap gap-2">
                {(["All", ...allPeople] as string[]).map((p) => (
                  <button
                    key={p} type="button"
                    onClick={() => setFilter(p)}
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
                    const isRefund = e.amount < 0;
                    const isPayment = !!e.isPayment;
                    const pal = paletteFor(e.paidBy, allPeople);
                    const isEditing = editingId === e.id;
                    const dueNow = isExpenseDueNow(e, todayIso);
                    const isFuture = e.createdAt > todayIso;
                    const split = effectiveSplit(e);
                    const weighted = hasCustomWeights(e);
                    const isDefaultSplit = !weighted && split.length === CORE_PEOPLE.length && CORE_PEOPLE.every((p) => split.includes(p));
                    const showSplitInfo = !isPayment && (!isDefaultSplit || weighted);

                    if (isEditing) {
                      return (
                        <GlassPanel key={e.id} className="p-4">
                          <p className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: "#22d3ee" }}>Edit transaction</p>
                          <form onSubmit={handleSaveEdit} className="space-y-3">
                            <InputField label="What was it for?">
                              <input type="text" value={editForm.title} onChange={(ev) => setEditForm((f) => ({ ...f, title: ev.target.value }))} style={inputStyle} autoFocus />
                            </InputField>
                            <div className="grid grid-cols-2 gap-3">
                              <InputField label="Amount">
                                <input type="number" inputMode="decimal" step="0.01" value={editForm.amount} onChange={(ev) => setEditForm((f) => ({ ...f, amount: ev.target.value }))} style={inputStyle} />
                              </InputField>
                              <InputField label="Who paid?">
                                <select value={editForm.paidBy} onChange={(ev) => setEditForm((f) => ({ ...f, paidBy: ev.target.value }))} style={inputStyle}>
                                  {allPeople.map((p) => <option key={p} value={p}>{p}</option>)}
                                </select>
                              </InputField>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <InputField label="Date">
                                <input type="date" value={editForm.date} onChange={(ev) => setEditForm((f) => ({ ...f, date: ev.target.value, dueNow: undefined }))} style={{ ...inputStyle, colorScheme: "dark" }} />
                              </InputField>
                              <InputField label="Category">
                                <select value={editForm.category} onChange={(ev) => setEditForm((f) => ({ ...f, category: ev.target.value }))} style={inputStyle}>
                                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </InputField>
                            </div>
                            {!e.isPayment && (
                              <SplitPicker
                                allPeople={allPeople}
                                splitBetween={editForm.splitBetween}
                                splitWeights={editForm.splitWeights}
                                amount={editForm.amount}
                                onChange={(sb, sw) => setEditForm((f) => ({ ...f, splitBetween: sb, splitWeights: sw }))}
                              />
                            )}
                            {editForm.date > todayIso && !e.isPayment && (
                              <div className="flex flex-col gap-1.5">
                                <span className="text-xs font-medium" style={{ color: "#94a3b8" }}>Due status</span>
                                <button
                                  type="button"
                                  onClick={() => setEditForm((f) => ({ ...f, dueNow: f.dueNow === true ? undefined : true }))}
                                  className="self-start px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                                  style={
                                    editForm.dueNow === true
                                      ? { background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.35)" }
                                      : { background: "rgba(251,191,36,0.1)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.25)" }
                                  }
                                >
                                  {editForm.dueNow === true ? "✓ Due now" : `Not due until ${shortDate(editForm.date)}`}
                                </button>
                              </div>
                            )}
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

                    // Payment card
                    if (isPayment) {
                      const [from, to] = [e.paidBy, effectiveSplit(e)[0] ?? ""];
                      return (
                        <div
                          key={e.id}
                          className="rounded-3xl p-4 flex items-center justify-between gap-3 cursor-pointer"
                          style={{ background: "rgba(52,211,153,0.07)", border: "1px solid rgba(52,211,153,0.18)" }}
                          onClick={() => startEdit(e)}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-sm font-bold" style={{ background: "rgba(52,211,153,0.15)", color: "#34d399" }}>
                              ✓
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white">
                                {from} <span style={{ color: "#34d399" }}>→</span> {to}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs font-semibold rounded-full px-2 py-0.5" style={{ background: "rgba(52,211,153,0.12)", color: "#34d399" }}>Payment</span>
                                <span className="text-xs" style={{ color: "#475569" }}>{shortDate(e.createdAt)}</span>
                                {e.note && <span className="text-xs truncate" style={{ color: "#64748b" }}>{e.note}</span>}
                              </div>
                            </div>
                          </div>
                          <p className="text-sm font-bold shrink-0" style={{ color: "#34d399" }}>{fmt(e.amount)}</p>
                        </div>
                      );
                    }

                    // Regular expense card
                    return (
                      <GlassPanel key={e.id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 flex-1 min-w-0" onClick={() => startEdit(e)} style={{ cursor: "pointer" }}>
                            <div
                              className="shrink-0 h-9 w-9 rounded-xl flex items-center justify-center text-xs font-bold"
                              style={isRefund ? { background: "rgba(52,211,153,0.15)", color: "#34d399" } : { background: pal.bg, color: pal.text }}
                            >
                              {isRefund ? "↩" : e.paidBy[0]}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                  <p className="text-sm font-semibold text-white truncate">{e.title}</p>
                                  {isRefund && (
                                    <span className="shrink-0 text-xs font-semibold rounded-full px-2 py-0.5" style={{ background: "rgba(52,211,153,0.15)", color: "#34d399" }}>
                                      Refund
                                    </span>
                                  )}
                                  {isFuture && (
                                    <span
                                      className="shrink-0 text-xs font-semibold rounded-full px-2 py-0.5"
                                      style={
                                        dueNow
                                          ? { background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.25)" }
                                          : { background: "rgba(251,191,36,0.1)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.2)" }
                                      }
                                    >
                                      {dueNow ? "Due now" : `Due ${shortDate(e.createdAt)}`}
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm font-bold shrink-0" style={{ color: isRefund ? "#34d399" : "#e2e8f0" }}>
                                  {isRefund ? `−${fmt(Math.abs(e.amount))}` : fmt(e.amount)}
                                </p>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 items-center">
                                <span className="text-xs" style={{ color: "#475569" }}>{e.category}</span>
                                <span className="text-xs" style={{ color: pal.text }}>{e.paidBy}</span>
                                <span className="text-xs" style={{ color: "#475569" }}>{shortDate(e.createdAt)}</span>
                              </div>
                              {showSplitInfo && (
                                <div className="mt-1.5">
                                  {weighted ? (
                                    <p className="text-xs" style={{ color: "#64748b" }}>
                                      ÷ {split.map((p) => `${p}: ${fmt(personShare(e, p))}`).join("  ·  ")}
                                    </p>
                                  ) : (
                                    <span className="text-xs rounded-full px-1.5 py-0.5 inline-block" style={{ background: "rgba(255,255,255,0.05)", color: "#64748b", border: "1px solid rgba(255,255,255,0.07)" }}>
                                      ÷ {split.join(" · ")}
                                    </span>
                                  )}
                                </div>
                              )}
                              {e.note && <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "#64748b" }}>{e.note}</p>}
                            </div>
                          </div>
                          <button
                            type="button" onClick={() => startEdit(e)}
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
                <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#22d3ee" }}>People</p>

                <InputField label="3rd person (optional — unlocks split options per transaction)">
                  <input type="text" placeholder="Name…" value={rental.thirdPerson} onChange={(e) => void updateRental("thirdPerson", e.target.value)} style={inputStyle} />
                </InputField>

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
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <p className="text-xs font-semibold tracking-widest uppercase mb-0.5" style={{ color: "#22d3ee" }}>Calendar</p>
                    <h2 className="text-lg font-bold text-white">{calendar.label}</h2>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => stepMonth(-1)} className="h-9 w-9 rounded-xl flex items-center justify-center transition-all hover:opacity-80" style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}>
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <button type="button" onClick={() => setCalendarAnchor(new Date().toISOString().split("T")[0])} className="px-3 h-9 rounded-xl text-xs font-medium transition-all hover:opacity-80" style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}>
                      Today
                    </button>
                    <button type="button" onClick={() => stepMonth(1)} className="h-9 w-9 rounded-xl flex items-center justify-center transition-all hover:opacity-80" style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}>
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-px rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                  {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                    <div key={d} className="py-2 text-center text-xs font-semibold" style={{ color: "#475569" }}>{d}</div>
                  ))}
                  {calendar.cells.map((cell) => {
                    const match = importantDates.find((d) => d.value === cell.iso);
                    const isBilling = billingDates.includes(cell.iso);
                    const isToday = cell.iso === todayIso;
                    const highlight = match ?? (isBilling ? { color: "#22d3ee", label: "Billing" } : null);
                    const dayExpenses = expenses.filter((ex) => ex.createdAt === cell.iso);
                    return (
                      <div
                        key={cell.iso}
                        className="relative flex flex-col items-center py-2 px-1 min-h-[56px]"
                        style={{
                          background: highlight ? `${highlight.color}14` : undefined,
                          border: highlight ? `1px solid ${highlight.color}40` : undefined,
                        }}
                      >
                        <span className="text-xs font-semibold" style={{ color: !cell.inMonth ? "#1e293b" : highlight ? highlight.color : isToday ? "#22d3ee" : "#e2e8f0" }}>
                          {cell.day}
                        </span>
                        {isToday && !highlight && <span className="mt-0.5 h-1 w-1 rounded-full" style={{ background: "#22d3ee" }} />}
                        {highlight && (
                          <span className="mt-0.5 text-center leading-tight" style={{ color: highlight.color, fontSize: "0.55rem", fontWeight: 700 }}>
                            {highlight.label.split(" ")[0]}
                          </span>
                        )}
                        {dayExpenses.length > 0 && cell.inMonth && (
                          <div className="mt-auto pt-1 flex gap-0.5 justify-center flex-wrap">
                            {dayExpenses.map((ex) => {
                              const pal = paletteFor(ex.paidBy, allPeople);
                              const col = ex.isPayment ? "#34d399" : ex.amount < 0 ? "#34d399" : pal.dot;
                              return <span key={ex.id} className="h-1.5 w-1.5 rounded-full" style={{ background: col }} />;
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {allPeople.map((p) => {
                    const pal = paletteFor(p, allPeople);
                    return (
                      <span key={p} className="flex items-center gap-1.5 text-xs" style={{ color: "#64748b" }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: pal.dot }} />
                        {p}
                      </span>
                    );
                  })}
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: "#64748b" }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#34d399" }} />
                    Refund / Payment
                  </span>
                </div>
              </GlassPanel>

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
