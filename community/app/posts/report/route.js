import { getBrowserUser } from "@/app/lib/browserUser";
import { buildGatewayIdentityHeaders } from "@/app/lib/internalUser";
import { createReportRouteHandlers } from "@/app/lib/routes/reportRoute";

export const runtime = "nodejs";

const handlers = createReportRouteHandlers({
  requireUser: getBrowserUser,
  buildGatewayIdentityHeaders,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
