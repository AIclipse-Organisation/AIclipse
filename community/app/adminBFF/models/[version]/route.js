import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";
const GATEWAY_URL = process.env.GATEWAY_URI || "http://gateway-srv:8000";

export async function DELETE(req, { params }) {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get("access_token")?.value;
    const { version } = params;

    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const res = await fetch(`${GATEWAY_URL}/admin/models/${version}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (!res.ok) throw new Error(`Gateway Error: ${res.status}`);

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}