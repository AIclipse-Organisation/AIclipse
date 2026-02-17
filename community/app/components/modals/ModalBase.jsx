"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export default function ModalBase({
  open,
  onClose,
  title,
  children,
  footer,
  closeLabel = "Close",
}) {
  const titleId = useId();
  const panelRef = useRef(null);

  // ESC to close + lock body scroll while open
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // focus the modal panel after mount
    const t = setTimeout(() => panelRef.current?.focus(), 0);

    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  // Click on backdrop closes; click inside panel does not
  const modal = (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        <div className="modal-header">
          {title ? (
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
          ) : (
            <div />
          )}

          <button className="modal-close" onClick={onClose} aria-label={closeLabel}>
            ✕
          </button>
        </div>

        <div className="modal-body">{children}</div>

        <div className="modal-footer">
          {footer ?? (
            <button className="modal-primary" onClick={onClose}>
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // Render at document.body so it sits above everything (Topbar/BottomNav/etc)
  return createPortal(modal, document.body);
}
