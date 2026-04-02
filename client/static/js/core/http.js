(function attachHttpHelpers(global) {
  function setDebug(targetId, data) {
    const pre = document.getElementById(targetId);
    if (!pre) return;
    pre.textContent = JSON.stringify(data, null, 2);
  }

  async function jsonFetch(method, url, body, options = {}) {
    const opts = {
      method,
      headers: { Accept: "application/json" },
      credentials: "include",
    };

    if (body !== undefined && body !== null) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = { detail: "Non-JSON response" };
    }

    if (options.debugTargetId) {
      setDebug(options.debugTargetId, { url, status: res.status, body: data });
    }

    return { res, data };
  }

  global.AIclipseHttp = {
    jsonFetch,
    setDebug,
  };
})(window);
