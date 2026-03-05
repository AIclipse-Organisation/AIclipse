import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";

const GATEWAY_URL = process.env.GATEWAY_URI;

function cleanToken(val) {
  if (!val) return null;
  return val.replace("Bearer ", "").replace(/"/g, "").trim();
}

export async function GET(req) {
  try {
    const cookieStore = await cookies();
    const token = cleanToken(cookieStore.get("access_token")?.value);

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Proxy to Gateway: /admin/models/training-images
    const res = await fetch(`${GATEWAY_URL}/admin/models/training-images`, {
      headers: { 
        "Authorization": `Bearer ${token}` 
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Gateway Error: ${res.status}`, detail: errText }, 
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("🔥 [AdminAPI GET Images] Exception:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}