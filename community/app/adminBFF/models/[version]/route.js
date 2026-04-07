import { proxyAdminJson } from "@/app/lib/adminGateway";

export const runtime = "nodejs";

export async function DELETE(req, { params }) {
  const { version } = await params;
  return proxyAdminJson({
    path: `/admin/models/${encodeURIComponent(version)}`,
    method: "DELETE",
  });
}
