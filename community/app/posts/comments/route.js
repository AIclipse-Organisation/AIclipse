import { getBrowserUser } from "@/app/lib/browserUser";
import { createCommentsRouteHandlers } from "@/app/lib/routes/commentsRoute";

export const runtime = "nodejs";

const handlers = createCommentsRouteHandlers({
  requireUser: getBrowserUser,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
