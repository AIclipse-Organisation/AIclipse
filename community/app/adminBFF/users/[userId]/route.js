import { proxyAdminJson } from "@/app/lib/adminGateway";

export const runtime = "nodejs";

export async function DELETE(req, { params }) {
  const { userId } = await params;
  return proxyAdminJson({
    request: req,
    path: `/auth/admin/user/${encodeURIComponent(userId)}`,
    method: "DELETE",
    body: await req.json(),
  });
}

export async function PATCH(req, { params }) {
  const { userId } = await params;
  return proxyAdminJson({
    request: req,
    path: `/auth/admin/user/${encodeURIComponent(userId)}`,
    method: "PATCH",
    body: await req.json(),
  });
}
