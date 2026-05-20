"use client";

import { FormEvent, useEffect, useState } from "react";

const ACCESS_KEY = "storage-cost-passcode-access";

type PasscodeGateProps = {
  children: React.ReactNode;
};

export function PasscodeGate({ children }: PasscodeGateProps) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = window.localStorage.getItem(ACCESS_KEY);
    if (saved === "granted") setIsUnlocked(true);
  }, []);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const expected = process.env.NEXT_PUBLIC_APP_PASSCODE?.trim() ?? "1754";
    if (input.trim() !== expected) {
      setError("Wrong passcode. Try again.");
      return;
    }
    window.localStorage.setItem(ACCESS_KEY, "granted");
    setError("");
    setIsUnlocked(true);
  }

  if (!mounted) return null;
  if (isUnlocked) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(135deg, #0a0f1a 0%, #0f1928 50%, #0a1520 100%)" }}>
      <div className="w-full max-w-sm">
        <div className="rounded-3xl border border-white/10 p-8 backdrop-blur-2xl" style={{ background: "rgba(15,25,40,0.85)", boxShadow: "0 32px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)" }}>
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: "linear-gradient(135deg, #22d3ee, #818cf8)" }}>
              <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <p className="text-xs font-semibold tracking-widest uppercase mb-1" style={{ color: "#22d3ee" }}>Private Access</p>
            <h1 className="text-2xl font-bold text-white">Manhattan Mini Storage</h1>
            <p className="mt-2 text-sm" style={{ color: "#94a3b8" }}>Eduardo & Martha — summer 2026</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: "#94a3b8" }}>Shared passcode</label>
              <input
                type="password"
                placeholder="Enter passcode"
                value={input}
                onChange={(e) => { setInput(e.target.value); setError(""); }}
                className="w-full rounded-xl px-4 py-3 text-white placeholder-white/30 outline-none focus:ring-2 transition-all"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              className="w-full rounded-xl py-3 font-semibold text-sm text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: "linear-gradient(135deg, #22d3ee, #818cf8)" }}
            >
              Unlock Dashboard
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
