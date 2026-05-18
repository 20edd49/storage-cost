"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { onValue, ref, set } from "firebase/database";
import { PasscodeGate } from "../components/PasscodeGate";
import { database, isFirebaseConfigured } from "../lib/firebase";

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

const STORAGE_KEY = "manhattan-mini-storage-dashboard";
const DASHBOARD_REF =
  "manhattanMiniStorage/privateSummer2026EduardoMartha/dashboard";

const seededExpenses: Expense[] = [
  {
    id: "seed-lock",
    title: "Disc lock",
    amount: 34,
    paidBy: "Eduardo",
    category: "Supplies",
    note: "Front desk recommended the heavy-duty one.",
    createdAt: "2026-05-12"
  },
  {
    id: "seed-van",
    title: "Van rental",
    amount: 96,
    paidBy: "Martha",
    category: "Transport",
    note: "Move-in day haul.",
    createdAt: "2026-05-14"
  }
];

const people: Person[] = ["Eduardo", "Martha"];
const today = new Date();

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD"
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric"
});

function formatMoney(value: number) {
  return currency.format(value);
}

function getInitialFormState() {
  return {
    title: "",
    amount: "",
    paidBy: "Eduardo" as Person,
    category: "Storage unit",
    note: ""
  };
}

function getInitialRentalState(): RentalInfo {
  return {
    facilityName: "Manhattan Mini Storage",
    moveInDate: "2026-05-14",
    chargeStartDate: "2026-05-15",
    billingDate: "2026-06-01",
    plannedMoveOutDate: "2026-08-28",
    unitLabel: "",
    note: "Use this panel for unit number, gate notes, or move-out reminders."
  };
}

function buildCalendarDays(anchorDate: string) {
  const focusDate = anchorDate ? new Date(anchorDate) : today;
  const year = focusDate.getFullYear();
  const month = focusDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const offset = (firstDay.getDay() + 6) % 7;
  const totalDays = lastDay.getDate();
  const cells: Array<{ date: string; day: number; isCurrentMonth: boolean }> = [];

  for (let index = 0; index < offset; index += 1) {
    const previous = new Date(year, month, index - offset + 1);
    cells.push({
      date: previous.toISOString(),
      day: previous.getDate(),
      isCurrentMonth: false
    });
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const current = new Date(year, month, day);
    cells.push({
      date: current.toISOString(),
      day,
      isCurrentMonth: true
    });
  }

  while (cells.length % 7 !== 0) {
    const next = new Date(year, month + 1, cells.length - (offset + totalDays) + 1);
    cells.push({
      date: next.toISOString(),
      day: next.getDate(),
      isCurrentMonth: false
    });
  }

  return {
    label: focusDate.toLocaleString("en-US", {
      month: "long",
      year: "numeric"
    }),
    cells
  };
}

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>(seededExpenses);
  const [rentalInfo, setRentalInfo] = useState<RentalInfo>(getInitialRentalState);
  const [form, setForm] = useState(getInitialFormState);
  const [selectedPayer, setSelectedPayer] = useState<"All" | Person>("All");
  const [syncStatus, setSyncStatus] = useState(
    isFirebaseConfigured ? "Connecting to Firebase..." : "Running in local mode"
  );

  useEffect(() => {
    if (database) {
      const dashboardRef = ref(database, DASHBOARD_REF);

      return onValue(dashboardRef, (snapshot) => {
        const value = snapshot.val() as DashboardPayload | null;

        if (!value) {
          const initialPayload = {
            expenses: seededExpenses,
            rentalInfo: getInitialRentalState()
          };
          void set(dashboardRef, initialPayload);
          setExpenses(initialPayload.expenses);
          setRentalInfo(initialPayload.rentalInfo);
          setSyncStatus("Firebase synced");
          return;
        }

        setExpenses(value.expenses ?? seededExpenses);
        setRentalInfo(value.rentalInfo ?? getInitialRentalState());
        setSyncStatus("Firebase synced");
      });
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as DashboardPayload;
      if (parsed.expenses?.length) {
        setExpenses(parsed.expenses);
      }
      if (parsed.rentalInfo) {
        setRentalInfo(parsed.rentalInfo);
      }
      setSyncStatus("Saved locally on this device");
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (database) {
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        expenses,
        rentalInfo
      })
    );
  }, [expenses, rentalInfo]);

  const filteredExpenses = useMemo(() => {
    if (selectedPayer === "All") {
      return expenses;
    }

    return expenses.filter((expense) => expense.paidBy === selectedPayer);
  }, [expenses, selectedPayer]);

  const summary = useMemo(() => {
    const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const byPerson = people.reduce<Record<Person, number>>(
      (acc, person) => {
        acc[person] = expenses
          .filter((expense) => expense.paidBy === person)
          .reduce((sum, expense) => sum + expense.amount, 0);
        return acc;
      },
      { Eduardo: 0, Martha: 0 }
    );
    const sharePerPerson = total / 2;
    const balances = {
      Eduardo: byPerson.Eduardo - sharePerPerson,
      Martha: byPerson.Martha - sharePerPerson
    };

    return {
      total,
      count: expenses.length,
      sharePerPerson,
      byPerson,
      balances
    };
  }, [expenses]);

  const calendar = useMemo(
    () => buildCalendarDays(rentalInfo.moveInDate || rentalInfo.chargeStartDate),
    [rentalInfo.chargeStartDate, rentalInfo.moveInDate]
  );

  const importantDates = useMemo(
    () =>
      [
        { key: "move-in", label: "Move in", value: rentalInfo.moveInDate, tone: "mint" },
        {
          key: "charge-start",
          label: "Charges start",
          value: rentalInfo.chargeStartDate,
          tone: "gold"
        },
        { key: "billing", label: "Billing date", value: rentalInfo.billingDate, tone: "blue" },
        {
          key: "move-out",
          label: "Planned move out",
          value: rentalInfo.plannedMoveOutDate,
          tone: "rose"
        }
      ].filter((item) => item.value),
    [
      rentalInfo.billingDate,
      rentalInfo.chargeStartDate,
      rentalInfo.moveInDate,
      rentalInfo.plannedMoveOutDate
    ]
  );

  async function writeDashboard(nextExpenses: Expense[], nextRentalInfo: RentalInfo) {
    if (database) {
      await set(ref(database, DASHBOARD_REF), {
        expenses: nextExpenses,
        rentalInfo: nextRentalInfo
      });
      return;
    }

    setExpenses(nextExpenses);
    setRentalInfo(nextRentalInfo);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedAmount = Number.parseFloat(form.amount);
    if (!form.title.trim() || Number.isNaN(normalizedAmount) || normalizedAmount <= 0) {
      return;
    }

    const nextExpense: Expense = {
      id: crypto.randomUUID(),
      title: form.title.trim(),
      amount: normalizedAmount,
      paidBy: form.paidBy,
      category: form.category.trim() || "Misc",
      note: form.note.trim(),
      createdAt: new Date().toISOString()
    };

    const nextExpenses = [nextExpense, ...expenses];
    setExpenses(nextExpenses);
    await writeDashboard(nextExpenses, rentalInfo);
    setForm(getInitialFormState());
  }

  async function handleDelete(id: string) {
    const nextExpenses = expenses.filter((expense) => expense.id !== id);
    setExpenses(nextExpenses);
    await writeDashboard(nextExpenses, rentalInfo);
  }

  async function handleRentalUpdate<K extends keyof RentalInfo>(
    key: K,
    value: RentalInfo[K]
  ) {
    const nextRentalInfo = { ...rentalInfo, [key]: value };
    setRentalInfo(nextRentalInfo);
    await writeDashboard(expenses, nextRentalInfo);
  }

  const eduardoStatus =
    summary.balances.Eduardo > 0
      ? `Martha owes Eduardo ${formatMoney(summary.balances.Eduardo)}`
      : summary.balances.Eduardo < 0
        ? `Eduardo owes Martha ${formatMoney(Math.abs(summary.balances.Eduardo))}`
        : "Even split right now";

  return (
    <PasscodeGate>
      <main className="page-shell">
        <section className="hero-panel">
          <div className="hero-copy">
            <span className="eyebrow">Summer storage admin</span>
            <h1>Manhattan Mini Storage</h1>
            <p>
              A polished mobile dashboard for tracking every storage-related expense,
              who paid, and how the split lands between Eduardo and Martha.
            </p>
          </div>

          <div className="hero-aside">
            <div className="hero-metric">
              <span>Total spend</span>
              <strong>{formatMoney(summary.total)}</strong>
            </div>
            <div className="hero-metric">
              <span>Entries logged</span>
              <strong>{summary.count}</strong>
            </div>
            <div className="hero-metric accent">
              <span>Sync status</span>
              <strong>{syncStatus}</strong>
            </div>
          </div>
        </section>

        <section className="dashboard-grid">
          <article className="panel panel-form">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Add expense</span>
                <h2>Log a new charge</h2>
              </div>
              <span className="badge">Live split</span>
            </div>

            <form className="expense-form" onSubmit={handleSubmit}>
              <label>
                <span>What was it for?</span>
                <input
                  type="text"
                  placeholder="Monthly rent, boxes, lock, van..."
                  value={form.title}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </label>

              <div className="form-row">
                <label>
                  <span>Cost</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, amount: event.target.value }))
                    }
                  />
                </label>

                <label>
                  <span>Who paid?</span>
                  <select
                    value={form.paidBy}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        paidBy: event.target.value as Person
                      }))
                    }
                  >
                    {people.map((person) => (
                      <option key={person} value={person}>
                        {person}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="form-row">
                <label>
                  <span>Category</span>
                  <input
                    type="text"
                    placeholder="Storage unit"
                    value={form.category}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, category: event.target.value }))
                    }
                  />
                </label>

                <label>
                  <span>Note</span>
                  <input
                    type="text"
                    placeholder="Optional detail"
                    value={form.note}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, note: event.target.value }))
                    }
                  />
                </label>
              </div>

              <button type="submit">Save expense</button>
            </form>
          </article>

          <article className="panel panel-summary">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Overview</span>
                <h2>Split snapshot</h2>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <span>Each person&apos;s share</span>
                <strong>{formatMoney(summary.sharePerPerson)}</strong>
              </div>
              <div className="stat-card">
                <span>Eduardo paid</span>
                <strong>{formatMoney(summary.byPerson.Eduardo)}</strong>
              </div>
              <div className="stat-card">
                <span>Martha paid</span>
                <strong>{formatMoney(summary.byPerson.Martha)}</strong>
              </div>
              <div className="stat-card highlight">
                <span>Current balance</span>
                <strong>{eduardoStatus}</strong>
              </div>
            </div>
          </article>

          <article className="panel panel-rental">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Rental info</span>
                <h2>Dates, billing, and unit details</h2>
              </div>
              <span className="badge muted">Editable</span>
            </div>

            <div className="expense-form">
              <div className="form-row">
                <label>
                  <span>Facility</span>
                  <input
                    type="text"
                    value={rentalInfo.facilityName}
                    onChange={(event) =>
                      void handleRentalUpdate("facilityName", event.target.value)
                    }
                  />
                </label>

                <label>
                  <span>Unit label</span>
                  <input
                    type="text"
                    placeholder="Unit 3B or locker 214"
                    value={rentalInfo.unitLabel}
                    onChange={(event) =>
                      void handleRentalUpdate("unitLabel", event.target.value)
                    }
                  />
                </label>
              </div>

              <div className="form-row">
                <label>
                  <span>Move in date</span>
                  <input
                    type="date"
                    value={rentalInfo.moveInDate}
                    onChange={(event) =>
                      void handleRentalUpdate("moveInDate", event.target.value)
                    }
                  />
                </label>

                <label>
                  <span>Charges start</span>
                  <input
                    type="date"
                    value={rentalInfo.chargeStartDate}
                    onChange={(event) =>
                      void handleRentalUpdate("chargeStartDate", event.target.value)
                    }
                  />
                </label>
              </div>

              <div className="form-row">
                <label>
                  <span>Billing date</span>
                  <input
                    type="date"
                    value={rentalInfo.billingDate}
                    onChange={(event) =>
                      void handleRentalUpdate("billingDate", event.target.value)
                    }
                  />
                </label>

                <label>
                  <span>Planned move out</span>
                  <input
                    type="date"
                    value={rentalInfo.plannedMoveOutDate}
                    onChange={(event) =>
                      void handleRentalUpdate("plannedMoveOutDate", event.target.value)
                    }
                  />
                </label>
              </div>

              <label>
                <span>Notes</span>
                <input
                  type="text"
                  value={rentalInfo.note}
                  onChange={(event) => void handleRentalUpdate("note", event.target.value)}
                />
              </label>
            </div>
          </article>

          <article className="panel panel-calendar">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Calendar</span>
                <h2>{calendar.label}</h2>
              </div>
              <span className="badge">Important dates</span>
            </div>

            <div className="calendar">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <span className="calendar-label" key={day}>
                  {day}
                </span>
              ))}

              {calendar.cells.map((cell) => {
                const matched = importantDates.find(
                  (item) =>
                    item.value &&
                    new Date(item.value).toDateString() ===
                      new Date(cell.date).toDateString()
                );

                return (
                  <div
                    key={cell.date}
                    className={[
                      "calendar-cell",
                      cell.isCurrentMonth ? "current-month" : "other-month",
                      matched ? `tone-${matched.tone}` : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <strong>{cell.day}</strong>
                    {matched ? <span>{matched.label}</span> : null}
                  </div>
                );
              })}
            </div>

            <div className="timeline-list">
              {importantDates.map((item) => (
                <div className={`timeline-item tone-${item.tone}`} key={item.key}>
                  <span>{item.label}</span>
                  <strong>{dateFormatter.format(new Date(item.value))}</strong>
                </div>
              ))}
            </div>
          </article>

          <article className="panel panel-table">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Ledger</span>
                <h2>Expense history</h2>
              </div>

              <div className="filter-group">
                <button
                  type="button"
                  className={selectedPayer === "All" ? "filter active" : "filter"}
                  onClick={() => setSelectedPayer("All")}
                >
                  All
                </button>
                {people.map((person) => (
                  <button
                    key={person}
                    type="button"
                    className={selectedPayer === person ? "filter active" : "filter"}
                    onClick={() => setSelectedPayer(person)}
                  >
                    {person}
                  </button>
                ))}
              </div>
            </div>

            <div className="ledger-list">
              {filteredExpenses.map((expense) => (
                <div className="ledger-item" key={expense.id}>
                  <div className="ledger-main">
                    <div className="ledger-topline">
                      <h3>{expense.title}</h3>
                      <strong>{formatMoney(expense.amount)}</strong>
                    </div>
                    <div className="ledger-meta">
                      <span>{expense.category}</span>
                      <span>Paid by {expense.paidBy}</span>
                      <span>{dateFormatter.format(new Date(expense.createdAt))}</span>
                    </div>
                    {expense.note ? <p>{expense.note}</p> : null}
                  </div>

                  <button
                    type="button"
                    className="delete-button"
                    onClick={() => void handleDelete(expense.id)}
                    aria-label={`Delete ${expense.title}`}
                  >
                    Remove
                  </button>
                </div>
              ))}

              {filteredExpenses.length === 0 ? (
                <div className="empty-state">
                  <h3>No expenses in this view</h3>
                  <p>Add the first charge to start tracking the split.</p>
                </div>
              ) : null}
            </div>
          </article>
        </section>
      </main>
    </PasscodeGate>
  );
}
