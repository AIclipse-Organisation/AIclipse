"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useXp } from "../../lib/xpContext";

function getContainerRect() {
  const el = document.querySelector(".app-container");
  if (!el) return null;
  return el.getBoundingClientRect();
}

export default function XpBar() {
  const xp = useXp();
  const [visible, setVisible] = useState(false);
  const [gained, setGained] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [prevScore, setPrevScore] = useState(null);
  const [fromProgress, setFromProgress] = useState(0);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    setMounted(true);
    setRect(getContainerRect());

    const onResize = () => setRect(getContainerRect());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!xp || !xp.initialized) return;
    if (prevScore === null) {
      setPrevScore(xp.score);
      return;
    }
    if (xp.score > prevScore) {
      setFromProgress((prevScore % 50) / 50);
      setGained(xp.score - prevScore);
      setPrevScore(xp.score);
      setRect(getContainerRect());
      setVisible(true);
    }
  }, [xp?.score]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), 2800);
    return () => clearTimeout(t);
  }, [visible]);

  if (!mounted || !xp || !rect) return null;

  const { level, progress } = xp;

  const toastWidth = rect.width - 32;
  const toastLeft = rect.left + rect.width / 2;

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          className="xp-toast"
          style={{ left: toastLeft, width: toastWidth }}
        >
          <span className="xp-toast-gained">+{gained} ★</span>
          <div className="xp-toast-mid">
            <span className="xp-toast-label">Lv.{level}</span>
            <div className="xp-toast-track">
              <motion.div
                className="xp-toast-fill"
                initial={{ width: `${fromProgress * 100}%` }}
                animate={{ width: `${progress * 100}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
              />
            </div>
            <span className="xp-toast-label">Lv.{level + 1}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
