import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";
const GATEWAY_URL = process.env.GATEWAY_URI

export async function GET(req) {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get("access_token")?.value;

    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const res = await fetch(`${GATEWAY_URL}/admin/models/current`, {
      headers: { "Authorization": `Bearer ${token}` },
      cache: "no-store",
    });

    if (res.status === 404) {
      return NextResponse.json({ error: "No active model" }, { status: 404 });
    }

    if (!res.ok) throw new Error(`Gateway Error: ${res.status}`);

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}