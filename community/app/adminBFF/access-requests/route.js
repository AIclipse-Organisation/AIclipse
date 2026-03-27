import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";

const GATEWAY_URL = process.env.GATEWAY_URI;

function cleanToken(val) {
  if (!val) return null;
  return val.replace("Bearer ", "").replace(/"/g, "").trim();
}

async function getToken() {
  const cookieStore = await cookies();
  return cleanToken(cookieStore.get("access_token")?.value);
}

function buildError(status, message, detail) {
  return NextResponse.json({ error: message, detail }, { status });
}

function safeParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function GET(req) {
  try {
    const token = await getToken();
    if (!token) return buildError(401, "Unauthorized");

    const searchParams = new URL(req.url).searchParams;
    const params = new URLSearchParams();

    for (const key of ["search", "page", "page_size"]) {
      const val = searchParams.get(key);
      if (val !== null && val !== "") params.set(key, val);
    }

    const res = await fetch(`${GATEWAY_URL}/auth/admin/access-requests?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const text = await res.text();
    const json = safeParse(text);
    if (!res.ok) return buildError(res.status, "Gateway Error", json || text);
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    return buildError(500, "Internal Error", err?.message || String(err));
  }
}
