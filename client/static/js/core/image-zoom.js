/**
 * Supports:
 *   - Mouse wheel zoom toward cursor
 *   - Drag to pan when zoomed
 *   - Double-click to toggle 2.5× zoom
 *   - Pinch-to-zoom on touch devices
 *   - Single-finger drag when zoomed on touch
 *   - ESC / close button / backdrop click to dismiss
 */
(function () {
  "use strict";

  var MIN_SCALE = 1;
  var MAX_SCALE = 4;

  var overlay = null;
  var zoomImg = null;
  var hintEl = null;
  var containerEl = null;

  var scale = 1;
  var tx = 0;
  var ty = 0;
  var isDragging = false;
  var lastPos = { x: 0, y: 0 };
  var pinchDist0 = null;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function applyTransform() {
    zoomImg.style.transform =
      "translate(" + tx + "px, " + ty + "px) scale(" + scale + ")";
    containerEl.style.cursor =
      scale > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in";
    hintEl.style.opacity = scale > 1 ? "1" : "0";
  }

  function getContainerCenter() {
    var r = containerEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function clampedTranslate(newTx, newTy, s) {
    var maxX = (containerEl.clientWidth * (s - 1)) / 2;
    var maxY = (containerEl.clientHeight * (s - 1)) / 2;
    return {
      x: clamp(newTx, -maxX, maxX),
      y: clamp(newTy, -maxY, maxY),
    };
  }

  function zoomToward(pivotX, pivotY, ratio) {
    var c = getContainerCenter();
    var px = pivotX - c.x;
    var py = pivotY - c.y;
    var newS = clamp(scale * ratio, MIN_SCALE, MAX_SCALE);
    if (newS <= MIN_SCALE) {
      scale = MIN_SCALE;
      tx = 0;
      ty = 0;
    } else {
      var newTx = px - ((px - tx) / scale) * newS;
      var newTy = py - ((py - ty) / scale) * newS;
      var ct = clampedTranslate(newTx, newTy, newS);
      scale = newS;
      tx = ct.x;
      ty = ct.y;
    }
    applyTransform();
  }

  function openModal(src) {
    scale = 1;
    tx = 0;
    ty = 0;
    zoomImg.src = src;
    applyTransform();
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    overlay.style.display = "none";
    document.body.style.overflow = "";
    scale = 1;
    tx = 0;
    ty = 0;
  }

  function onWheel(e) {
    e.preventDefault();
    zoomToward(e.clientX, e.clientY, e.deltaY > 0 ? 0.85 : 1.15);
  }

  function onMouseDown(e) {
    if (scale <= 1) return;
    isDragging = true;
    lastPos = { x: e.clientX, y: e.clientY };
    containerEl.style.cursor = "grabbing";
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    var dx = e.clientX - lastPos.x;
    var dy = e.clientY - lastPos.y;
    lastPos = { x: e.clientX, y: e.clientY };
    var ct = clampedTranslate(tx + dx, ty + dy, scale);
    tx = ct.x;
    ty = ct.y;
    applyTransform();
  }

  function onMouseUp() {
    isDragging = false;
    containerEl.style.cursor = scale > 1 ? "grab" : "zoom-in";
  }

  function onDoubleClick(e) {
    if (scale > 1) {
      scale = 1;
      tx = 0;
      ty = 0;
      applyTransform();
    } else {
      zoomToward(e.clientX, e.clientY, 2.5);
    }
  }

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      pinchDist0 = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      isDragging = false;
    } else if (e.touches.length === 1 && scale > 1) {
      isDragging = true;
      lastPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2 && pinchDist0 !== null) {
      var dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      var midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      var midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomToward(midX, midY, dist / pinchDist0);
      pinchDist0 = dist;
    } else if (e.touches.length === 1 && isDragging) {
      var dx = e.touches[0].clientX - lastPos.x;
      var dy = e.touches[0].clientY - lastPos.y;
      lastPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      var ct = clampedTranslate(tx + dx, ty + dy, scale);
      tx = ct.x;
      ty = ct.y;
      applyTransform();
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length < 2) pinchDist0 = null;
    if (e.touches.length === 0) isDragging = false;
  }

  function buildOverlay() {
    var el = document.createElement("div");
    el.className = "imgzoom-backdrop";
    el.style.display = "none";
    el.innerHTML =
      '<button class="imgzoom-close" aria-label="Close zoom">' +
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">' +
      '<line x1="18" y1="6" x2="6" y2="18"/>' +
      '<line x1="6" y1="6" x2="18" y2="18"/>' +
      "</svg></button>" +
      '<div class="imgzoom-container">' +
      '<img class="imgzoom-img" alt="" draggable="false" />' +
      "</div>" +
      '<p class="imgzoom-hint" style="opacity:0">Double-tap / click to reset</p>';

    overlay = el;
    containerEl = el.querySelector(".imgzoom-container");
    zoomImg = el.querySelector(".imgzoom-img");
    hintEl = el.querySelector(".imgzoom-hint");

    // Backdrop click closes
    el.addEventListener("click", function (e) {
      if (e.target === el) closeModal();
    });

    // Close button
    el.querySelector(".imgzoom-close").addEventListener("click", closeModal);

    // ESC key
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.style.display !== "none") closeModal();
    });

    // Mouse events
    containerEl.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    containerEl.addEventListener("dblclick", onDoubleClick);

    // Wheel (non-passive)
    containerEl.addEventListener("wheel", onWheel, { passive: false });

    // Touch events
    containerEl.addEventListener("touchstart", onTouchStart, { passive: true });
    containerEl.addEventListener("touchmove", onTouchMove, { passive: false });
    containerEl.addEventListener("touchend", onTouchEnd, { passive: true });

    document.body.appendChild(el);
  }

  /**
   * Attach zoom behaviour to an <img> element.
   * Safe to call multiple times on the same element (idempotent).
   */
  function attachImageZoom(srcImg) {
    if (!overlay) buildOverlay();
    if (srcImg._zoomAttached) return;
    srcImg._zoomAttached = true;
    srcImg.style.cursor = "zoom-in";
    srcImg.addEventListener("click", function () {
      if (srcImg.src) openModal(srcImg.src);
    });
  }

  window.attachImageZoom = attachImageZoom;
})();
