const { fetch: originalFetch } = window;

function getFetchUrl(input) {
  try {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    if (input && typeof input.url === "string") return input.url;
  } catch {}
  return "";
}

function showLoader(message) {
  if (window.AppLoader && typeof window.AppLoader.show === "function") {
    window.AppLoader.show(message);
  }
}

function hideLoader() {
  if (window.AppLoader && typeof window.AppLoader.hide === "function") {
    window.AppLoader.hide();
  }
}

window.fetch = async (...args) => {
  const url = getFetchUrl(args[0]);
  const isApiCall = url.includes("/api/") || url.includes("/scan");

  if (isApiCall) showLoader("Analyzing Image...");

  try {
    return await originalFetch(...args);
  } finally {
    if (isApiCall) hideLoader();
  }
};

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("form").forEach((form) => {
    form.addEventListener("submit", () => {
      showLoader("Processing...");
    });
  });

  document.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      const href = link.getAttribute("href");
      if (href && !href.startsWith("#") && !link.target) {
        showLoader("Loading...");
      }
    });
  });
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    hideLoader();
  }
});
