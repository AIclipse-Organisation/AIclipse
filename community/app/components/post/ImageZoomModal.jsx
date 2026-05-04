"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export default function ImageZoomModal({ src, alt, onClose }) {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const hintRef = useRef(null);

  const scale = useRef(1);
  const tx = useRef(0);
  const ty = useRef(0);
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const pinchDist0 = useRef(null);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Close on ESC
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function applyTransform() {
    if (imgRef.current) {
      imgRef.current.style.transform = `translate(${tx.current}px, ${ty.current}px) scale(${scale.current})`;
    }
    if (containerRef.current) {
      containerRef.current.style.cursor =
        scale.current > 1 ? (isDragging.current ? "grabbing" : "grab") : "zoom-in";
    }
    if (hintRef.current) {
      hintRef.current.style.opacity = scale.current > 1 ? "1" : "0";
    }
  }

  function getContainerCenter() {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function clampedTranslate(newTx, newTy, s) {
    const el = containerRef.current;
    if (!el) return { x: newTx, y: newTy };
    const maxX = (el.clientWidth * (s - 1)) / 2;
    const maxY = (el.clientHeight * (s - 1)) / 2;
    return { x: clamp(newTx, -maxX, maxX), y: clamp(newTy, -maxY, maxY) };
  }

  function zoomToward(pivotX, pivotY, ratio) {
    const c = getContainerCenter();
    const px = pivotX - c.x;
    const py = pivotY - c.y;
    const newS = clamp(scale.current * ratio, MIN_SCALE, MAX_SCALE);
    if (newS <= MIN_SCALE) {
      scale.current = MIN_SCALE;
      tx.current = 0;
      ty.current = 0;
    } else {
      const newTx = px - ((px - tx.current) / scale.current) * newS;
      const newTy = py - ((py - ty.current) / scale.current) * newS;
      const ct = clampedTranslate(newTx, newTy, newS);
      scale.current = newS;
      tx.current = ct.x;
      ty.current = ct.y;
    }
    applyTransform();
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onWheel(e) {
      e.preventDefault();
      zoomToward(e.clientX, e.clientY, e.deltaY > 0 ? 0.85 : 1.15);
    }

    function onTouchMove(e) {
      e.preventDefault();
      if (e.touches.length === 2 && pinchDist0.current !== null) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        zoomToward(midX, midY, dist / pinchDist0.current);
        pinchDist0.current = dist;
      } else if (e.touches.length === 1 && isDragging.current) {
        const dx = e.touches[0].clientX - lastPos.current.x;
        const dy = e.touches[0].clientY - lastPos.current.y;
        lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        const ct = clampedTranslate(tx.current + dx, ty.current + dy, scale.current);
        tx.current = ct.x;
        ty.current = ct.y;
        applyTransform();
      }
    }

    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchmove", onTouchMove);
    };
  }, []); 

  function onMouseDown(e) {
    if (scale.current <= 1) return;
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    if (containerRef.current) containerRef.current.style.cursor = "grabbing";
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    const ct = clampedTranslate(tx.current + dx, ty.current + dy, scale.current);
    tx.current = ct.x;
    ty.current = ct.y;
    applyTransform();
  }

  function onMouseUp() {
    isDragging.current = false;
    if (containerRef.current) {
      containerRef.current.style.cursor = scale.current > 1 ? "grab" : "zoom-in";
    }
  }

  function onDoubleClick(e) {
    if (scale.current > 1) {
      scale.current = 1;
      tx.current = 0;
      ty.current = 0;
      applyTransform();
    } else {
      zoomToward(e.clientX, e.clientY, 2.5);
    }
  }

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      pinchDist0.current = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      isDragging.current = false;
    } else if (e.touches.length === 1 && scale.current > 1) {
      isDragging.current = true;
      lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length < 2) pinchDist0.current = null;
    if (e.touches.length === 0) isDragging.current = false;
  }

  const modal = (
    <div
      className="imgzoom-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button className="imgzoom-close" onClick={onClose} aria-label="Close zoom">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div
        ref={containerRef}
        className="imgzoom-container"
        style={{ cursor: "zoom-in" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onDoubleClick={onDoubleClick}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className="imgzoom-img"
          draggable={false}
        />
      </div>

      <p ref={hintRef} className="imgzoom-hint" style={{ opacity: 0 }}>
        Double-tap / click to reset
      </p>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modal, document.body)
    : null;
}
