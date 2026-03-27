import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Counter } from "k6/metrics";
import encoding from "k6/encoding";

const ORIGIN = String(__ENV.ORIGIN || "http://aiclipse.local").replace(/\/+$/, "");

const PROFILE = String(__ENV.PROFILE || "peak").toLowerCase(); // smoke | soak | peak
const BASE_RPS = Number(__ENV.BASE_RPS || 5); // iterations/s (flows/s)
const PEAK_RPS = Number(__ENV.PEAK_RPS || 15);
const LOGIN_RPS = Number(__ENV.LOGIN_RPS || 5);
const MAX_VUS = Number(__ENV.MAX_VUS || 80);

const USERS_RAW = String(__ENV.USERS || "");
const STRICT = String(__ENV.STRICT || "0") === "1";

// write controls
const ENABLE_UPLOAD = String(__ENV.ENABLE_UPLOAD || "1") === "1";
const UPLOAD_RATIO = Number(__ENV.UPLOAD_RATIO || 0.25); // within scan flow
const ENABLE_COMMUNITY_WRITE = String(__ENV.ENABLE_COMMUNITY_WRITE || "0") === "1";
const ENABLE_APIKEY_WRITE = String(__ENV.ENABLE_APIKEY_WRITE || "0") === "1";
const ENABLE_ADMIN_PROBES = String(__ENV.ENABLE_ADMIN_PROBES || "1") === "1";

const ROUTES_FILE = String(__ENV.ROUTES_FILE || "./routes.json");
const MAX_ATTEMPTS = Number(__ENV.MAX_ATTEMPTS || 2);

// -------------------- URL layout --------------------
const CLIENT_URL = ORIGIN;
const GATEWAY_URL = `${ORIGIN}/api`;
const COMMUNITY_URL = `${ORIGIN}/community`;

// -------------------- Fixtures --------------------
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
const http0 = new Rate("http_status_0");
const route404 = new Counter("route_404");
const authFail = new Rate("auth_fail");

// -------------------- Helpers --------------------
function params(extra = {}) {
  return {
    headers: extra.headers || {},
    tags: extra.tags || {},
    timeout: extra.timeout || "30s",
    redirects: extra.redirects ?? 0,
    responseType: extra.responseType || "none",
  };
}

function jsonParams(tags = {}) {
  return params({
    headers: { "Content-Type": "application/json" },
    tags,
    responseType: "text",
  });
}

function bearerParams(token, tags = {}) {
  return params({
    headers: { Authorization: `Bearer ${token}` },
    tags,
    responseType: "text",
  });
}

function authJsonParams(token, tags = {}) {
  return params({
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    tags,
    responseType: "text",
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
  const items = USERS_RAW.split(";").map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const it of items) {
    const idx = it.indexOf(":");
    if (idx <= 0) continue;
    const email = it.slice(0, idx).trim();
    const password = it.slice(idx + 1).trim();
    if (email && password) out.push({ email, password });
  }
  return out;
}
const USERS = usersPool();

function pickUser() {
  if (!USERS.length) return null;
  return USERS[(__VU - 1) % USERS.length];
}

function jitterSleep(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  sleep(ms / 1000);
}

function classify(res, area) {
  http0.add(res.status === 0 ? 1 : 0);

  const is5xx = res.status >= 500 || res.status === 0;
  if (area === "gw") gw5xx.add(is5xx ? 1 : 0);
  if (area === "client") client5xx.add(is5xx ? 1 : 0);
  if (area === "comm") comm5xx.add(is5xx ? 1 : 0);

  if (res.status === 404) route404.add(1);
}

function retryable(status) {
  return status === 0 || status === 429 || status === 502 || status === 503 || status === 504;
}

function requestWithRetry(method, url, body, p, area, maxAttempts = MAX_ATTEMPTS) {
  let attempt = 0;
  let res;
  while (attempt < Math.max(1, maxAttempts)) {
    attempt++;
    res = http.request(method, url, body, p);
    classify(res, area);
    if (!retryable(res.status)) return res;
    sleep(0.1 * attempt + Math.random() * 0.2);
  }
  return res;
}

function okOneOf(status, allowed) {
  for (const a of allowed) if (status === a) return true;
  return false;
}

function tryPaths(method, baseUrl, paths, body, p, area, allowedStatuses) {
  let last = null;
  for (const path of paths) {
    const url = `${baseUrl}${path}`;
    const res = requestWithRetry(method, url, body, p, area, MAX_ATTEMPTS);
    last = res;
    if (okOneOf(res.status, allowedStatuses)) return res;
    if (STRICT && res.status >= 400 && res.status < 500 && res.status !== 404) return res;
  }
  return last;
}

function loadRoutesConfig() {
  try {
    const raw = open(ROUTES_FILE);
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === "object" ? cfg : null;
  } catch {
    return null;
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

// -------------------- Options / Scenarios --------------------
function optionsByProfile() {
  const preVUsMain = Math.min(MAX_VUS, Math.max(10, Math.ceil(PEAK_RPS * 1.6)));
  const preVUsLogin = Math.min(MAX_VUS, Math.max(10, Math.ceil(LOGIN_RPS * 2.5)));

  if (PROFILE === "smoke") {
    return {
      insecureSkipTLSVerify: true,
      discardResponseBodies: true,
      thresholds: {
        http_req_failed: ["rate<0.05"],
        http_req_duration: ["p(95)<5000"],
        gw_5xx: ["rate<0.03"],
        client_5xx: ["rate<0.03"],
      },
      scenarios: {
        user_mix: {
          executor: "per-vu-iterations",
          vus: Math.min(5, MAX_VUS),
          iterations: 6,
          maxDuration: "4m",
          exec: "user_mix",
        },
      },
    };
  }

  if (PROFILE === "soak") {
    return {
      insecureSkipTLSVerify: true,
      discardResponseBodies: true,
      thresholds: {
        http_req_failed: ["rate<0.05"],
        http_req_duration: ["p(95)<6000"],
        gw_5xx: ["rate<0.03"],
        client_5xx: ["rate<0.03"],
      },
      scenarios: {
        user_mix: {
          executor: "constant-arrival-rate",
          rate: BASE_RPS,
          timeUnit: "1s",
          duration: "20m",
          preAllocatedVUs: preVUsMain,
          maxVUs: MAX_VUS,
          exec: "user_mix",
        },
      },
    };
  }

  return {
    insecureSkipTLSVerify: true,
    discardResponseBodies: true,
    thresholds: {
      http_req_failed: ["rate<0.03"],
      http_req_duration: ["p(95)<5500"],
      gw_5xx: ["rate<0.03"],
      client_5xx: ["rate<0.03"],
      comm_5xx: ["rate<0.04"],
      "http_req_duration{endpoint:client_login}": ["p(95)<3000"],
      "http_req_duration{endpoint:gw_login}": ["p(95)<3000"],
      "http_req_duration{endpoint:checks}": ["p(95)<9000"],
      "http_req_duration{endpoint:upload}": ["p(95)<14000"],
    },
    scenarios: {
      user_mix: {
        executor: "ramping-arrival-rate",
        timeUnit: "1s",
        startRate: Math.max(1, Math.floor(BASE_RPS / 2)),
        stages: [
          { duration: "1m", target: BASE_RPS },
          { duration: "2m", target: PEAK_RPS },
          { duration: "2m", target: PEAK_RPS },
          { duration: "1m", target: BASE_RPS },
          { duration: "30s", target: 0 },
        ],
        preAllocatedVUs: preVUsMain,
        maxVUs: MAX_VUS,
        exec: "user_mix",
        gracefulStop: "30s",
      },
      login_storm: {
        executor: "ramping-arrival-rate",
        timeUnit: "1s",
        startTime: "45s",
        startRate: 0,
        stages: [
          { duration: "20s", target: Math.max(1, Math.floor(LOGIN_RPS / 2)) },
          { duration: "40s", target: LOGIN_RPS },
          { duration: "20s", target: 0 },
        ],
        preAllocatedVUs: preVUsLogin,
        maxVUs: MAX_VUS,
        exec: "login_storm",
        gracefulStop: "30s",
      },
    },
  };
}
export const options = optionsByProfile();

// -------------------- Discovery (OpenAPI) --------------------
function discoverOpenApi() {
  const candidates = [
    `${GATEWAY_URL}/openapi.json`,
    `${GATEWAY_URL}/swagger/v1/swagger.json`,
    `${GATEWAY_URL}/swagger.json`,
  ];

  for (const url of candidates) {
    const res = requestWithRetry("GET", url, null, params({ tags: { endpoint: "openapi_probe" }, responseType: "text" }), "gw", 1);
    if (res && res.status === 200) {
      const js = safeJson(res);
      if (js && (js.openapi || js.swagger) && js.paths) return js;
    }
  }
  return null;
}

function buildOpenApiGetList(spec) {
  if (!spec || !spec.paths) return [];
  const out = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    if (!path || String(path).includes("{")) continue;
    const m = methods || {};
    if (m.get) out.push({ method: "GET", path: String(path) });
    else if (m.head) out.push({ method: "HEAD", path: String(path) });
  }
  return shuffle(out).slice(0, 40);
}

function hitOpenApiSample(openapiGets, token) {
  if (!openapiGets || !openapiGets.length) return;

  const n = Math.min(openapiGets.length, 2 + Math.floor(Math.random() * 3)); // 2..4
  for (let i = 0; i < n; i++) {
    const ep = openapiGets[Math.floor(Math.random() * openapiGets.length)];
    const path = String(ep.path || "");
    if (!path.startsWith("/")) continue;

    const url = path.startsWith("/api/") ? `${ORIGIN}${path}` : `${GATEWAY_URL}${path}`;
    const p = token ? bearerParams(token, { endpoint: `openapi:${path}` }) : params({ tags: { endpoint: `openapi:${path}` }, responseType: "text" });

    const res = requestWithRetry("GET", url, null, p, "gw", 1);
    check(res, {
      "openapi ok": (r) =>
        r.status === 200 ||
        r.status === 204 ||
        r.status === 301 ||
        r.status === 302 ||
        r.status === 304 ||
        r.status === 401 ||
        r.status === 403 ||
        r.status === 404,
    });

    jitterSleep(20, 80);
  }
}

// -------------------- setup() --------------------
export function setup() {
  console.log(`[k6] ORIGIN=${ORIGIN} ROUTES_FILE=${ROUTES_FILE}`);

  const cfg = loadRoutesConfig();
  const openapi = discoverOpenApi();
  const openapiGets = buildOpenApiGetList(openapi);

  return { routesConfig: cfg, openapiGets };
}

// -------------------- Routes --------------------
function defaultRoutes() {
  return {
    pages: ["/", "/upload", "/scans", "/notification", "/plan", "/profile", "/results", "/viewscan", "/dev", "/docs", "/contact", "/healthz"],
    static: ["/favicon.ico", "/robots.txt", "/sitemap.xml"],

    apiPublic: ["/openapi.json", "/docs", "/community/images"],
    communityPublic: ["/posts", "/posts?limit=20"],

    apiLogin: ["/auth/login"],
    apiAuthMe: ["/auth/me"],
    apiApiKey: ["/auth/api-key"],

    apiChecks: ["/v1/checks", "/checks"],
    apiUpload: ["/upload/image"],
    apiImagesList: ["/images"],
    apiImageGet: ["/image/"],

    apiAdminUsers: ["/auth/admin/users"],
    apiModelsList: ["/models"],
    apiModelsCurrent: ["/models/current"],
    apiModelsTrainingImages: ["/models/training-images"],
    apiModelsTrain: ["/models/train"],

    clientLogin: ["/auth/login"],
    clientMe: ["/auth/me"],
    clientLogout: ["/logout"],
    clientApiKey: ["/auth/api-key"],

    clientChecks: ["/checks"],
    clientUpload: ["/upload/image"],
    clientImagesList: ["/images"],
    clientImageGet: ["/image/"],

    communityPosts: ["/community/posts"],
    communityVote: ["/community/posts/vote"],
    communityCommentsList: ["/community/posts/comments"],
    communityCommentCreate: ["/community/posts/comments"],
    communityClick: ["/community/posts/click"],
    communityReport: ["/community/posts/report"],
  };
}

function mergedRoutes(cfg) {
  const d = defaultRoutes();
  if (!cfg) return d;

  const out = { ...d };
  for (const k of Object.keys(d)) {
    if (Array.isArray(cfg[k])) out[k] = cfg[k];
  }
  return out;
}

// -------------------- Flows --------------------
function pingIngress() {
  const res = requestWithRetry("GET", `${CLIENT_URL}/healthz`, null, params({ tags: { endpoint: "ingress_healthz" } }), "client", 1);
  check(res, { "ingress /healthz 200|404": (r) => r.status === 200 || r.status === 404 });
}

function probePublic(routes) {
  group("probe public", () => {
    const reqs = [];

    for (const p of routes.pages) reqs.push(["GET", `${CLIENT_URL}${p}`, null, params({ tags: { endpoint: `page:${p}` } })]);
    for (const p of routes.static) reqs.push(["GET", `${CLIENT_URL}${p}`, null, params({ tags: { endpoint: `static:${p}` } })]);
    for (const p of routes.apiPublic) reqs.push(["GET", `${GATEWAY_URL}${p}`, null, params({ tags: { endpoint: `api_public:${p}` }, responseType: "text" })]);
    for (const p of routes.communityPublic) reqs.push(["GET", `${COMMUNITY_URL}${p}`, null, params({ tags: { endpoint: `community_public:${p}` }, responseType: "text" })]);

    const resps = http.batch(reqs);
    for (const r of resps) {
      classify(r, "client");
      check(r, {
        "public ok": (x) =>
          x.status === 200 ||
          x.status === 204 ||
          x.status === 301 ||
          x.status === 302 ||
          x.status === 304 ||
          x.status === 401 ||
          x.status === 403 ||
          x.status === 404,
      });
    }
  });
}

function clientLogin(routes) {
  const u = pickUser();
  if (!u) return { ok: false };

  const res = tryPaths(
    "POST",
    CLIENT_URL,
    routes.clientLogin,
    JSON.stringify({ email: u.email, password: u.password }),
    jsonParams({ endpoint: "client_login" }),
    "client",
    [200],
  );

  const ok = !!res && check(res, {
    "client login 200": (r) => r.status === 200,
    "client sets access_token cookie": (r) => r.cookies && r.cookies.access_token && r.cookies.access_token.length > 0,
  });

  if (!ok) {
    authFail.add(1);
    return { ok: false, status: res?.status ?? 0 };
  }

  authFail.add(0);

  const cookieToken = res.cookies.access_token[0].value;
  const user = safeJson(res, "user") || null;
  const user_id = user?.user_id || user?.id || parseJwtSub(cookieToken) || null;

  return { ok: true, user_id, email: u.email };
}

function gatewayLogin(routes) {
  const u = pickUser();
  if (!u) return { ok: false };

  const res = tryPaths(
    "POST",
    GATEWAY_URL,
    routes.apiLogin,
    JSON.stringify({ email: u.email, password: u.password }),
    jsonParams({ endpoint: "gw_login" }),
    "gw",
    [200],
  );

  const ok = !!res && check(res, { "gateway login 200": (r) => r.status === 200 });
  if (!ok) {
    authFail.add(1);
    return { ok: false, status: res?.status ?? 0 };
  }
  authFail.add(0);

  let token = safeJson(res, "token");
  if (typeof token === "string" && token.toLowerCase().startsWith("bearer ")) token = token.split(" ", 2)[1].trim();
  if (!token) return { ok: false, status: 200 };

  const user = safeJson(res, "user") || null;
  const user_id = user?.user_id || user?.id || parseJwtSub(token) || null;

  return { ok: true, token, user_id, email: u.email };
}

function doScanViaGateway(routes, openapiGets) {
  const login = gatewayLogin(routes);
  if (!login.ok) return;

  group("gw scan", () => {
    const fx = pickFixture();

    const checksRes = tryPaths(
      "POST",
      GATEWAY_URL,
      routes.apiChecks,
      { file: http.file(fx.bytes, fx.name, "image/jpeg") },
      bearerParams(login.token, { endpoint: "checks" }),
      "gw",
      [200, 201, 400, 401, 403, 404],
    );

    const okChecks = check(checksRes, { "gw checks 200|201": (r) => r.status === 200 || r.status === 201 });
    const detection_token = safeJson(checksRes, "detection_token");

    const list = tryPaths("GET", GATEWAY_URL, routes.apiImagesList, null, bearerParams(login.token, { endpoint: "gw_images_list" }), "gw", [200, 401, 403, 404]);
    check(list, { "gw images list ok": (r) => r && (r.status === 200 || r.status === 401 || r.status === 403 || r.status === 404) });

    if (openapiGets && Math.random() < 0.4) hitOpenApiSample(openapiGets, login.token);

    if (!ENABLE_UPLOAD || Math.random() > UPLOAD_RATIO) return;
    if (!okChecks || !detection_token) return;

    const uploadRes = tryPaths(
      "POST",
      GATEWAY_URL,
      routes.apiUpload,
      { file: http.file(fx.bytes, fx.name, "image/jpeg"), detection_token, is_public: "false" },
      bearerParams(login.token, { endpoint: "upload" }),
      "gw",
      [200, 201, 202, 400, 401, 403, 404, 409],
    );

    check(uploadRes, { "gw upload ok": (r) => r.status === 200 || r.status === 201 || r.status === 202 || (r.status >= 400 && r.status < 500) });
  });
}

function doScanViaClient(routes) {
  const login = clientLogin(routes);
  if (!login.ok) return;

  group("client scan", () => {
    const fx = pickFixture();

    const checksRes = tryPaths(
      "POST",
      CLIENT_URL,
      routes.clientChecks,
      { file: http.file(fx.bytes, fx.name, "image/jpeg") },
      params({ tags: { endpoint: "checks" }, responseType: "text" }),
      "client",
      [200, 201, 400, 401, 403, 404],
    );

    const okChecks = check(checksRes, { "client checks 200|201": (r) => r.status === 200 || r.status === 201 });
    const detection_token = safeJson(checksRes, "detection_token");

    const list = tryPaths("GET", CLIENT_URL, routes.clientImagesList, null, params({ tags: { endpoint: "client_images_list" }, responseType: "text" }), "client", [200, 401, 403, 404]);
    check(list, { "client images list ok": (r) => r && (r.status === 200 || r.status === 401 || r.status === 403 || r.status === 404) });

    if (!ENABLE_UPLOAD || Math.random() > UPLOAD_RATIO) return;
    if (!okChecks || !detection_token) return;

    const uploadRes = tryPaths(
      "POST",
      CLIENT_URL,
      routes.clientUpload,
      { file: http.file(fx.bytes, fx.name, "image/jpeg"), detection_token, is_public: "false" },
      params({ tags: { endpoint: "upload" }, responseType: "text" }),
      "client",
      [200, 201, 202, 400, 401, 403, 404, 409],
    );

    check(uploadRes, { "client upload ok": (r) => r.status === 200 || r.status === 201 || r.status === 202 || (r.status >= 400 && r.status < 500) });
  });
}

// -------------------- Scenario entrypoints --------------------
export function user_mix(data) {
  const routes = mergedRoutes(data?.routesConfig);

  pingIngress();
  probePublic(routes);

  const r = Math.random();

  if (r < 0.65) {
    if (Math.random() < 0.5) doScanViaClient(routes);
    else doScanViaGateway(routes, data?.openapiGets);
    jitterSleep(300, 1800);
    return;
  }

  clientLogin(routes);
  if (Math.random() < 0.2) hitOpenApiSample(data?.openapiGets, null);
  jitterSleep(200, 1200);
}

export function login_storm(data) {
  const routes = mergedRoutes(data?.routesConfig);
  if (Math.random() < 0.5) clientLogin(routes);
  else gatewayLogin(routes);
}