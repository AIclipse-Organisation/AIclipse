import { buildAdminError, proxyAdminJson } from "@/app/lib/adminGateway";

export const runtime = "nodejs";

export async function POST(_req, { params }) {
  const { userId } = await params;
  if (!userId) return buildAdminError(400, "Bad Request", "Missing userId");

  return proxyAdminJson({
    path: `/auth/admin/access-requests/${encodeURIComponent(userId)}/approve`,
    method: "POST",
  });
}
