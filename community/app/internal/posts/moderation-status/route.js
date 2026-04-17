import { requireInternalRequest } from "@/app/lib/internalUser";
import { createModerationStatusPostHandler } from "@/app/lib/routes/moderationStatusRoute";

export const runtime = "nodejs";

export const POST = createModerationStatusPostHandler({
  requireInternalRequest,
});
