function setCurrentUserChip(user) {
  if (window.AuthUI && typeof window.AuthUI.setUser === "function") {
    window.AuthUI.setUser(user);
    return;
  }

  const chip = document.getElementById("current-user-chip");
  if (!chip) return;

  if (!user) {
    chip.textContent = "Not signed in";
    chip.classList.remove("success");
    chip.classList.add("muted");
    return;
  }

  const name = user.user_name || user.email || "User";
  chip.textContent = `${name} · plan ${user.plan ?? "?"}`;
  chip.classList.remove("muted");
  chip.classList.add("success");
}
