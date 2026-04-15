(function attachStatusRenderer(global) {
  function renderStatus(el, type, text) {
    if (!el) return;
    el.innerHTML = "";
    if (!text) return;

    const span = document.createElement("span");
    span.textContent = text;
    span.classList.add(
      type === "success"
        ? "status-success"
        : type === "error"
          ? "status-error"
          : "status-info",
    );
    el.appendChild(span);
  }

  global.AIclipseStatus = {
    render: renderStatus,
  };
})(window);
