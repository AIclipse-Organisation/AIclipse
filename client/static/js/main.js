
// Login AUTH 
function setCurrentUserChip(user) {
  const chip = document.getElementById("current-user-chip");
  if (!chip) return;
  if (!user) {
    chip.textContent = "Not signed in";
    chip.classList.remove("success");
    return;
  }
  chip.textContent = `${user.user_name || user.email || "User"} · plan ${user.plan ?? "?"}`;
}

  // Initial auth/me to populate header user chip (silent if fails)
  (async () => {
    try {
      const { res, data } = await jsonFetch("GET", "/auth/me", null);
      if (res.ok) {
        setCurrentUserChip(data);
        setStatus(document.getElementById("detect-status"), "info", "Session restored from cookie.");
      } else {
        setCurrentUserChip(null);
      }
    } catch {
      // ignore
    }
  })();