import { buildAdminError, proxyAdminJson } from "@/app/lib/adminGateway";

export const runtime = "nodejs";

export async function DELETE(_req, { params }) {
  const { userId } = await params;
  if (!userId) return buildAdminError(400, "Bad Request", "Missing userId");

  return proxyAdminJson({
    request: _req,
    path: `/auth/admin/access-requests/${encodeURIComponent(userId)}/reject`,
    method: "DELETE",
  });
}
