(function attachAuthScreenHelpers(global) {
  function onEl(id, callback) {
    const el = document.getElementById(id);
    if (el) callback(el);
  }

  function bytesLenUtf8(s) {
    try {
      if (typeof TextEncoder !== "undefined") {
        return new TextEncoder().encode(String(s || "")).length;
      }
    } catch {}
    return String(s || "").length;
  }

  function evaluatePasswordPolicy(password) {
    const p = String(password || "");
    const len = bytesLenUtf8(p);

    return {
      min_length: len >= 8,
      max_length: len <= 72,
      no_spaces: !/\s/.test(p),
      has_lowercase: /[a-z]/.test(p),
      has_uppercase: /[A-Z]/.test(p),
      has_number: /\d/.test(p),
      has_symbol: /[^A-Za-z0-9]/.test(p),
    };
  }

  function isPasswordPolicyOk(checks) {
    if (!checks || typeof checks !== "object") return false;
    const keys = Object.keys(checks);
    if (keys.length === 0) return false;
    return keys.every((k) => checks[k] === true);
  }

  function applyPasswordPolicyUI(rootEl, password, checks) {
    if (!rootEl) return;
    const p = String(password || "");
    const items = rootEl.querySelectorAll("li[data-rule]");

    items.forEach((li) => {
      const rule = li.getAttribute("data-rule");
      const ok = !!(checks && checks[rule]);

      li.classList.remove("is-neutral", "is-ok", "is-bad");

      const icon = li.querySelector(".policy-icon");
      if (!p) {
        li.classList.add("is-neutral");
        if (icon) icon.textContent = "•";
        return;
      }

      if (ok) {
        li.classList.add("is-ok");
        if (icon) icon.textContent = "✓";
        return;
      }

      li.classList.add("is-bad");
      if (icon) icon.textContent = "✕";
    });
  }

  function normalizeApiErrorDetail(data) {
    const detail = data && data.detail;

    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] || {};
      const loc = Array.isArray(first.loc) ? first.loc.join(".") : null;
      const msg = typeof first.msg === "string" ? first.msg : "Validation error";
      return { message: loc ? `${loc}: ${msg}` : msg, checks: null, code: null };
    }

    if (typeof detail === "string") {
      return { message: detail, checks: null };
    }

    if (detail && typeof detail === "object") {
      return {
        message: detail.message || detail.detail || "Request failed",
        checks: detail.checks && typeof detail.checks === "object" ? detail.checks : null,
        code: detail.code || null,
      };
    }

    return { message: (data && data.message) || "Request failed", checks: null };
  }

  function parseDobDayMonthYear(dobString) {
    const raw = String(dobString || "").trim();
    const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const dob = new Date(year, month - 1, day);

    if (
      Number.isNaN(dob.getTime()) ||
      dob.getFullYear() !== year ||
      dob.getMonth() !== month - 1 ||
      dob.getDate() !== day
    ) {
      return null;
    }

    return dob;
  }

  function ageFromDobString(dobString) {
    const dob = parseDobDayMonthYear(dobString);
    if (!dob) return null;
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const hasBirthdayPassed =
      today.getMonth() > dob.getMonth() ||
      (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
    if (!hasBirthdayPassed) age -= 1;
    return age;
  }

  global.AuthScreenHelpers = {
    ageFromDobString,
    applyPasswordPolicyUI,
    evaluatePasswordPolicy,
    isPasswordPolicyOk,
    normalizeApiErrorDetail,
    onEl,
  };
})(window);
