async function loadPartials() {
  const nodes = document.querySelectorAll("[data-include]");
  for (const el of nodes) {
    const url = el.getAttribute("data-include");
    const res = await fetch(url);
    el.outerHTML = await res.text();
  }
}

document.addEventListener("DOMContentLoaded", loadPartials);
