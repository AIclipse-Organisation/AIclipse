import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";
const GATEWAY_URL = process.env.GATEWAY_URI 

export async function POST(req) {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get("access_token")?.value;

    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const res = await fetch(`${GATEWAY_URL}/admin/models/train`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (!res.ok) throw new Error(`Gateway Error: ${res.status}`);

    // Gateway might return text or JSON
    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json({ message: text });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}