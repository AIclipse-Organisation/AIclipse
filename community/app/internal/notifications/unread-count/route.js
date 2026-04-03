import { getForwardedUser } from "@/app/lib/internalUser";
import { createNotificationsUnreadCountHandler } from "@/app/lib/routes/notificationsRoute";

export const runtime = "nodejs";

export const GET = createNotificationsUnreadCountHandler({
  requireUser: getForwardedUser,
});
