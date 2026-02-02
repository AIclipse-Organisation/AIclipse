import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Counter } from "k6/metrics";
import encoding from "k6/encoding";

// -------------------- ENV (only what your docker command sets) --------------------
const BASE_URL = __ENV.BASE_URL || "http://host.docker.internal";
const INGRESS_HOST = __ENV.INGRESS_HOST || "aiclipse.local";

const PROFILE = (__ENV.PROFILE || "peak").toLowerCase(); // peak | soak | smoke
const BASE_RPS = Number(__ENV.BASE_RPS || 10); // iterations/s (sessions/s), not raw HTTP rps
const PEAK_RPS = Number(__ENV.PEAK_RPS || 40);
const LOGIN_RPS = Number(__ENV.LOGIN_RPS || 10);
const MAX_VUS = Number(__ENV.MAX_VUS || 200);

const USERS_RAW = __ENV.USERS || "";
const STRICT = (__ENV.STRICT || "0") === "1"; // if 1 -> treat some failures as hard errors (still no fail()).

// -------------------- URL layout (your ingress) --------------------
const ORIGIN = BASE_URL;
const CLIENT_URL = ORIGIN; // web client + BFF on root
const GATEWAY_URL = `${ORIGIN}/api`; // gateway behind /api
const COMMUNITY_URL = `${ORIGIN}/community`; // community behind /community

// -------------------- Fixtures (10 images) --------------------
// k6 open() must be evaluated at init-time. Keep explicit list for reliability.
const FIXTURES = [
  { name: "test1.jpg", bytes: open("./fixtures/test1.jpg", "b") },
  { name: "test2.jpg", bytes: open("./fixtures/test2.jpg", "b") },
  { name: "test3.jpg", bytes: open("./fixtures/test3.jpg", "b") },
  { name: "test4.jpg", bytes: open("./fixtures/test4.jpg", "b") },
  { name: "test5.jpg", bytes: open("./fixtures/test5.jpg", "b") },
  { name: "test6.jpg", bytes: open("./fixtures/test6.jpg", "b") },
  { name: "test7.jpg", bytes: open("./fixtures/test7.jpg", "b") },
  { name: "test8.jpg", bytes: open("./fixtures/test8.jpg", "b") },
  { name: "test9.jpg", bytes: open("./fixtures/test9.jpg", "b") },
  { name: "test10.jpg", bytes: open("./fixtures/test10.jpg", "b") },
];

function pickFixture() {
  return FIXTURES[Math.floor(Math.random() * FIXTURES.length)];
}

// -------------------- Metrics --------------------
const gw5xx = new Rate("gw_5xx");
const client5xx = new Rate("client_5xx");
const comm5xx = new Rate("comm_5xx");

const gwAuthFail = new Rate("gw_auth_fail");
const clientAuthFail = new Rate("client_auth_fail");

const commClick404 = new Counter("comm_click_404");
const gwLogin502 = new Counter("gw_login_502");
const clientLogin502 = new Counter("client_login_502");

// -------------------- Helpers --------------------
function withHostHeader(headers = {}) {
  return INGRESS_HOST ? { ...headers, Host: INGRESS_HOST } : headers;
}

function params(extra = {}) {
  return {
    headers: withHostHeader(extra.headers || {}),
    tags: extra.tags || {},
    timeout: extra.timeout || "30s",
  };
}

function jsonParams(tags = {}) {
  return params({
    headers: { "Content-Type": "application/json" },
    tags,
  });
}

function bearerParams(token, tags = {}) {
  return params({
    headers: { Authorization: `Bearer ${token}` },
    tags,
  });
}

function authJsonParams(token, tags = {}) {
  return params({
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    tags,
  });
}

function safeJson(res, path) {
  try {
    return res.json(path);
  } catch {
    return null;
  }
}

function parseJwtSub(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  const payload = encoding.b64decode(parts[1], "rawurl", "s");
  try {
    return JSON.parse(payload)?.sub || null;
  } catch {
    return null;
  }
}

function usersPool() {
  // "email:pass;email:pass;..."
  const items = USERS_RAW.split(";").map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const it of items) {
    const [email, password] = it.split(":");
    if (email && password) out.push({ email: email.trim(), password: password.trim() });
  }
  return out;
}

const USERS = usersPool();

function pickUser() {
  // With only 5 accounts, many VUs will reuse them. That's OK for stress, but note it can skew auth bottlenecks.
  if (!USERS.length) return null;
  return USERS[(__VU - 1) % USERS.length];
}

function jitterSleep(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  sleep(ms / 1000);
}

function classify5xx(res, area) {
  if (res.status >= 500 || res.status === 0) {
    if (area === "gw") gw5xx.add(1);
    if (area === "client") client5xx.add(1);
    if (area === "comm") comm5xx.add(1);
  } else {
    if (area === "gw") gw5xx.add(0);
    if (area === "client") client5xx.add(0);
    if (area === "comm") comm5xx.add(0);
  }
}

function retryable(status) {
  return status === 0 || status === 429 || status === 502 || status === 503 || status === 504;
}

function requestWithRetry(method, url, body, p, area, maxAttempts = 2) {
  let attempt = 0;
  let res;
  while (attempt < maxAttempts) {
    attempt++;
    if (method === "GET") res = http.get(url, p);
    else if (method === "POST") res = http.post(url, body, p);
    else if (method === "PATCH") res = http.patch(url, body, p);
    else if (method === "DEL") res = http.del(url, body, p);
    else res = http.request(method, url, body, p);

    classify5xx(res, area);

    if (!retryable(res.status)) return res;

    // backoff + jitter
    sleep(0.1 * attempt + Math.random() * 0.2);
  }
  return res;
}

// -------------------- Options / Scenarios --------------------
function optionsByProfile() {
  // IMPORTANT:
  // arrival-rate uses "iterations per second". Each iteration is a "user session chunk" with multiple HTTP requests.
  // BASE_RPS/PEAK_RPS therefore approximate "active user flows per second".
  const preVUs = Math.min(MAX_VUS, Math.max(50, Math.ceil(PEAK_RPS * 6)));
  const maxVUs = Math.max(preVUs, MAX_VUS);

  if (PROFILE === "smoke") {
    return {
      insecureSkipTLSVerify: true,
      thresholds: {
        http_req_failed: ["rate<0.05"],
        http_req_duration: ["p(95)<4000"],
      },
      scenarios: {
        user_mix: {
          executor: "per-vu-iterations",
          vus: Math.min(5, MAX_VUS),
          iterations: 5,
          maxDuration: "2m",
          exec: "user_mix",
        },
      },
    };
  }

  if (PROFILE === "soak") {
    return {
      insecureSkipTLSVerify: true,
      thresholds: {
        http_req_failed: ["rate<0.05"],
        http_req_duration: ["p(95)<5000"],
      },
      scenarios: {
        user_mix: {
          executor: "constant-arrival-rate",
          rate: BASE_RPS,
          timeUnit: "1s",
          duration: "30m",
          preAllocatedVUs: preVUs,
          maxVUs: maxVUs,
          exec: "user_mix",
        },
      },
    };
  }

  // peak (default)
  return {
    insecureSkipTLSVerify: true,
    thresholds: {
      http_req_failed: ["rate<0.02"],
      http_req_duration: ["p(95)<4000"],

      // useful slices by endpoint (tags)
      "http_req_duration{endpoint:client_login}": ["p(95)<2500"],
      "http_req_duration{endpoint:gw_login}": ["p(95)<2500"],
      "http_req_duration{endpoint:gw_checks}": ["p(95)<6000"],
      "http_req_duration{endpoint:gw_upload}": ["p(95)<9000"],
      "http_req_duration{endpoint:client_checks}": ["p(95)<6000"],
      "http_req_duration{endpoint:client_upload}": ["p(95)<9000"],
    },
    scenarios: {
      // main mixed traffic
      user_mix: {
        executor: "ramping-arrival-rate",
        timeUnit: "1s",
        startRate: Math.max(1, Math.floor(BASE_RPS / 2)),
        stages: [
          { duration: "2m", target: BASE_RPS },      // warm
          { duration: "4m", target: PEAK_RPS },      // ramp to peak
          { duration: "5m", target: PEAK_RPS },      // hold
          { duration: "2m", target: BASE_RPS },      // cool
          { duration: "1m", target: 0 },
        ],
        preAllocatedVUs: preVUs,
        maxVUs: maxVUs,
        exec: "user_mix",
        gracefulStop: "30s",
      },

      // login burst in parallel (simulates promos / morning traffic)
      login_storm: {
        executor: "ramping-arrival-rate",
        timeUnit: "1s",
        startTime: "1m",
        startRate: 0,
        stages: [
          { duration: "20s", target: Math.max(1, Math.floor(LOGIN_RPS / 2)) },
          { duration: "40s", target: LOGIN_RPS },
          { duration: "30s", target: 0 },
        ],
        preAllocatedVUs: Math.min(MAX_VUS, Math.max(30, Math.ceil(LOGIN_RPS * 8))),
        maxVUs: Math.min(MAX_VUS, Math.max(50, Math.ceil(LOGIN_RPS * 12))),
        exec: "login_storm",
        gracefulStop: "30s",
      },
    },
  };
}

export const options = optionsByProfile();

// -------------------- Low-level calls --------------------
function pingIngress() {
  const res = requestWithRetry("GET", `${CLIENT_URL}/healthz`, null, params({ tags: { endpoint: "ingress_healthz" } }), "client");
  check(res, { "ingress /healthz 200": (r) => r.status === 200 });
}

function browseAnon() {
  group("anon browse", () => {
    const pages = ["/", "/community/posts", "/healthz", "/api/healthz"];
    for (const p of pages) {
      const url = `${CLIENT_URL}${p}`;
      const ep = p === "/" ? "page_root" : `page_${p.replace(/\//g, "_")}`;
      const res = requestWithRetry("GET", url, null, params({ tags: { endpoint: ep } }), "client");
      check(res, { "page 200": (r) => r.status === 200 });
      jitterSleep(50, 200);
    }
  });
}

// Client BFF login -> cookie jar
function clientLogin() {
  const u = pickUser();
  if (!u) return { ok: false };

  const res = requestWithRetry(
    "POST",
    `${CLIENT_URL}/auth/login`,
    JSON.stringify({ email: u.email, password: u.password }),
    jsonParams({ endpoint: "client_login" }),
    "client",
    2,
  );

  if (res.status === 502) clientLogin502.add(1);

  const ok = check(res, {
    "client login 200": (r) => r.status === 200,
    "client sets access_token cookie": (r) => r.cookies && r.cookies.access_token && r.cookies.access_token.length > 0,
  });

  if (!ok) {
    clientAuthFail.add(1);
    return { ok: false, status: res.status };
  }

  clientAuthFail.add(0);

  const cookieToken = res.cookies.access_token[0].value;
  const user = safeJson(res, "user") || null;
  const user_id = user?.user_id || user?.id || parseJwtSub(cookieToken) || null;

  return { ok: true, user_id, email: u.email };
}

function gatewayLogin() {
  const u = pickUser();
  if (!u) return { ok: false };

  const res = requestWithRetry(
    "POST",
    `${GATEWAY_URL}/auth/login`,
    JSON.stringify({ email: u.email, password: u.password }),
    jsonParams({ endpoint: "gw_login" }),
    "gw",
    2,
  );

  if (res.status === 502) gwLogin502.add(1);

  const ok = check(res, { "gateway login 200": (r) => r.status === 200 });
  if (!ok) {
    gwAuthFail.add(1);
    return { ok: false, status: res.status };
  }

  gwAuthFail.add(0);

  let token = safeJson(res, "token");
  if (typeof token === "string" && token.toLowerCase().startsWith("bearer ")) token = token.split(" ", 2)[1].trim();
  if (!token) return { ok: false, status: 200 };

  const user = safeJson(res, "user") || null;
  const user_id = user?.user_id || user?.id || parseJwtSub(token) || null;

  return { ok: true, token, user_id, email: u.email };
}

// Scan via gateway (JWT)
function doScanViaGateway() {
  const login = gatewayLogin();
  if (!login.ok) return;

  group("gw scan", () => {
    const hz = requestWithRetry("GET", `${GATEWAY_URL}/healthz`, null, params({ tags: { endpoint: "gw_healthz" } }), "gw");
    check(hz, { "gateway /api/healthz 200": (r) => r.status === 200 });

    const fx = pickFixture();

    const checksRes = requestWithRetry(
      "POST",
      `${GATEWAY_URL}/v1/checks`,
      { file: http.file(fx.bytes, fx.name, "image/jpeg") },
      bearerParams(login.token, { endpoint: "gw_checks" }),
      "gw",
      1,
    );

    const okChecks = check(checksRes, { "gw /v1/checks 200": (r) => r.status === 200 });
    if (!okChecks) return;

    const detection_token = safeJson(checksRes, "detection_token");
    if (!detection_token) return;

    const uploadRes = requestWithRetry(
      "POST",
      `${GATEWAY_URL}/upload/image`,
      {
        file: http.file(fx.bytes, fx.name, "image/jpeg"),
        detection_token,
        is_public: "true",
      },
      bearerParams(login.token, { endpoint: "gw_upload" }),
      "gw",
      1,
    );

    const okUp = check(uploadRes, { "gw /upload/image 201": (r) => r.status === 201 });
    if (!okUp) return;

    // response shape can differ between versions -> don't hard-fail; just validate if present
    const image_id = safeJson(uploadRes, "image.image_id") || safeJson(uploadRes, "image_id");
    if (image_id) {
      const one = requestWithRetry(
        "GET",
        `${GATEWAY_URL}/image/${image_id}`,
        null,
        bearerParams(login.token, { endpoint: "gw_image_get" }),
        "gw",
        1,
      );
      check(one, { "gw /image/{id} 200|404": (r) => r.status === 200 || r.status === 404 });
    }
  });
}

// Scan via client (cookie) + light browsing
function doScanViaClient() {
  const login = clientLogin();
  if (!login.ok) return;

  group("client scan", () => {
    const me = requestWithRetry("GET", `${CLIENT_URL}/auth/me`, null, params({ tags: { endpoint: "client_me" } }), "client");
    // if auth is flaky under load, this will show 401/502 without killing the run
    check(me, { "client /auth/me 200": (r) => r.status === 200 });

    const fx = pickFixture();

    const checksRes = requestWithRetry(
      "POST",
      `${CLIENT_URL}/checks`,
      { file: http.file(fx.bytes, fx.name, "image/jpeg") },
      params({ tags: { endpoint: "client_checks" } }),
      "client",
      1,
    );

    const okChecks = check(checksRes, { "client /checks 200": (r) => r.status === 200 });
    if (!okChecks) return;

    const detection_token = safeJson(checksRes, "detection_token");
    if (!detection_token) return;

    const uploadRes = requestWithRetry(
      "POST",
      `${CLIENT_URL}/upload/image`,
      {
        file: http.file(fx.bytes, fx.name, "image/jpeg"),
        detection_token,
        is_public: "true",
      },
      params({ tags: { endpoint: "client_upload" } }),
      "client",
      1,
    );

    check(uploadRes, { "client /upload/image 201": (r) => r.status === 201 });
  });
}

// Community direct interactions (JWT via gateway)
function communityCreateAndInteractDirect() {
  const login = gatewayLogin();
  if (!login.ok) return;

  group("community direct", () => {
    // feed (no auth)
    const feed = requestWithRetry("GET", `${COMMUNITY_URL}/posts`, null, params({ tags: { endpoint: "comm_feed" } }), "comm");
    check(feed, { "community /posts 200": (r) => r.status === 200 });

    // create post (auth)
    const createRes = requestWithRetry(
      "POST",
      `${COMMUNITY_URL}/posts`,
      JSON.stringify({
        user_id: login.user_id || "unknown",
        image_id: "00000000-0000-0000-0000-000000000000", // if API requires real image_id, some will 4xx; that’s OK in peak
        description: "k6 peak test post",
        result: { verdict: "unknown" },
      }),
      authJsonParams(login.token, { endpoint: "comm_create" }),
      "comm",
      1,
    );

    check(createRes, {
      "community create 201|409|403": (r) => r.status === 201 || r.status === 409 || r.status === 403,
    });

    const post_id = safeJson(createRes, "post_id") || safeJson(createRes, "post.post_id");
    if (!post_id) return;

    // vote (auth)
    const voteRes = requestWithRetry(
      "POST",
      `${COMMUNITY_URL}/posts/vote`,
      JSON.stringify({ post_id, user_id: login.user_id, vote: "up" }),
      authJsonParams(login.token, { endpoint: "comm_vote" }),
      "comm",
      1,
    );
    check(voteRes, { "community vote 200": (r) => r.status === 200 });

    // comments list (no auth)
    const listRes = requestWithRetry(
      "GET",
      `${COMMUNITY_URL}/posts/comments?post_id=${encodeURIComponent(post_id)}`,
      null,
      params({ tags: { endpoint: "comm_comments_list" } }),
      "comm",
      1,
    );
    check(listRes, { "community comments 200": (r) => r.status === 200 });

    // click (no auth обычно), but can be missing on some pods -> don't stop run
    const clickRes = requestWithRetry(
      "POST",
      `${COMMUNITY_URL}/posts/click`,
      JSON.stringify({ post_id, user_id: login.user_id }),
      jsonParams({ endpoint: "comm_click" }),
      "comm",
      1,
    );

    if (clickRes.status === 404) commClick404.add(1);

    check(clickRes, {
      "community click 200|404": (r) => r.status === 200 || r.status === 404,
    });

    // report (no auth)
    const reportRes = requestWithRetry(
      "POST",
      `${COMMUNITY_URL}/posts/report`,
      JSON.stringify({ post_id }),
      jsonParams({ endpoint: "comm_report" }),
      "comm",
      1,
    );
    check(reportRes, { "community report 200": (r) => r.status === 200 });
  });
}

// -------------------- Scenario entrypoints --------------------
export function user_mix() {
  // Keep a light health ping to see when ingress goes red
  pingIngress();

  // Weighted distribution: looks like real product usage
  const r = Math.random();

  // 35% anonymous browsing
  if (r < 0.35) {
    browseAnon();
    jitterSleep(200, 1200);
    return;
  }

  // 25% auth browsing (login + me + a couple pages)
  if (r < 0.60) {
    group("auth browse", () => {
      const login = clientLogin();
      if (login.ok) {
        const me = requestWithRetry("GET", `${CLIENT_URL}/auth/me`, null, params({ tags: { endpoint: "client_me" } }), "client");
        check(me, { "client /auth/me 200": (r) => r.status === 200 });
      }
      // even if auth failed, user still browses a bit
      browseAnon();
    });
    jitterSleep(300, 1500);
    return;
  }

  // 25% heavy scan flow (mix client/gateway)
  if (r < 0.85) {
    // half via client, half via gateway
    if (Math.random() < 0.5) doScanViaClient();
    else doScanViaGateway();
    jitterSleep(500, 2500);
    return;
  }

  // 15% community interactions
  communityCreateAndInteractDirect();
  jitterSleep(400, 1800);
}

export function login_storm() {
  // pure auth pressure, no extra pages
  const r = Math.random();
  if (r < 0.5) clientLogin();
  else gatewayLogin();
}
