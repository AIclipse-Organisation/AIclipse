import { getForwardedUser } from "@/app/lib/internalUser";
import { createNotificationsListHandler } from "@/app/lib/routes/notificationsRoute";

export const runtime = "nodejs";

export const GET = createNotificationsListHandler({
  requireUser: getForwardedUser,
});
