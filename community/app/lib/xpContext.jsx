"use client";

import { createContext, useContext, useEffect, useState } from "react";

const XpContext = createContext(null);

export function XpProvider({ children }) {
  const [score, setScore] = useState(0);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    fetch("/auth/me", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.community_score != null) {
          setScore(Number(data.community_score));
        }
      })
      .catch(() => {})
      .finally(() => setInitialized(true));
  }, []);

  function addXp(n) {
    setScore((s) => s + n);
  }

  const level = Math.floor(score / 50) + 1;
  const progress = (score % 50) / 50;

  return (
    <XpContext.Provider value={{ score, level, progress, addXp, initialized }}>
      {children}
    </XpContext.Provider>
  );
}

export function useXp() {
  return useContext(XpContext);
}
