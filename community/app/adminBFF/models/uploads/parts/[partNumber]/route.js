import { proxyAdminUploadPart } from "@/app/lib/adminGateway";

export async function PUT(req, { params }) {
  return proxyAdminUploadPart({
    request: req,
    path: `/admin/models/uploads/parts/${params.partNumber}`,
  });
}
