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

export async function DELETE(req, { params }) {
  try {
    const token = await getToken();
    if (!token) return buildError(401, "Unauthorized");
    const { userId } = await params;

    const body = await req.json();
    const res = await fetch(`${GATEWAY_URL}/auth/admin/user/${userId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
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

export async function PATCH(req, { params }) {
  try {
    const token = await getToken();
    if (!token) return buildError(401, "Unauthorized");
    const { userId } = await params;

    const body = await req.json();
    const res = await fetch(`${GATEWAY_URL}/auth/admin/user/${userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
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
