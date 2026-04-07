import { getBrowserUser } from "@/app/lib/browserUser";
import { createNotificationsReadHandler } from "@/app/lib/routes/notificationsRoute";

export const runtime = "nodejs";

export const POST = createNotificationsReadHandler({
  requireUser: getBrowserUser,
});
