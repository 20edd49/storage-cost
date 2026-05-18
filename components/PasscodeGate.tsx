"use client";

import { FormEvent, useEffect, useState } from "react";

const ACCESS_KEY = "storage-cost-passcode-access";
const DEFAULT_PASSCODE = "mini-summer-2026";

type PasscodeGateProps = {
  children: React.ReactNode;
};

export function PasscodeGate({ children }: PasscodeGateProps) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem(ACCESS_KEY);
    if (saved === "granted") {
      setIsUnlocked(true);
    }
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const expected =
      process.env.NEXT_PUBLIC_APP_PASSCODE?.trim() || DEFAULT_PASSCODE;

    if (input.trim() !== expected) {
      setError("Wrong passcode. Try again.");
      return;
    }

    window.localStorage.setItem(ACCESS_KEY, "granted");
    setError("");
    setIsUnlocked(true);
  }

  if (isUnlocked) {
    return <>{children}</>;
  }

  return (
    <main className="gate-shell">
      <section className="gate-card">
        <span className="eyebrow">Private access</span>
        <h1>Manhattan Mini Storage</h1>
        <p>
          Enter the shared passcode to view the storage dashboard for Eduardo
          and Martha.
        </p>

        <form className="gate-form" onSubmit={handleSubmit}>
          <label>
            <span>Shared passcode</span>
            <input
              type="password"
              placeholder="Enter passcode"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                if (error) {
                  setError("");
                }
              }}
            />
          </label>

          {error ? <p className="gate-error">{error}</p> : null}

          <button type="submit">Unlock dashboard</button>
        </form>
      </section>
    </main>
  );
}
