"use client";

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

let _nextId = 0;

export function XpFloatLayer({ floats }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {floats.map((f) => (
        <motion.div
          key={f.id}
          initial={{ opacity: 0, y: 0, scale: 0.7 }}
          animate={{ opacity: 1, y: -32, scale: 1 }}
          exit={{ opacity: 0, y: -64, scale: 0.8 }}
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
          style={{
            position: "fixed",
            left: f.x,
            top: f.y,
            transform: "translateX(-50%)",
            pointerEvents: "none",
            zIndex: 9999,
            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            fontWeight: 800,
            fontSize: 18,
            color: "#CFB87C",
            textShadow: "0 1px 6px rgba(0,0,0,0.85), 0 0 12px rgba(207,184,124,0.4)",
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
          }}
        >
          +{f.points}
        </motion.div>
      ))}
    </AnimatePresence>,
    document.body
  );
}

export function useXpFloat() {
  const [floats, setFloats] = useState([]);

  const triggerFloat = useCallback((buttonRef, points = 1) => {
    if (!buttonRef?.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const id = ++_nextId;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    setFloats((prev) => [...prev, { id, x, y, points }]);
    setTimeout(() => {
      setFloats((prev) => prev.filter((f) => f.id !== id));
    }, 700);
  }, []);

  return { triggerFloat, floats };
}
