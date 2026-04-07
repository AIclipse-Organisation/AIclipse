import { getBrowserUser } from "@/app/lib/browserUser";
import { createVoteHandler } from "@/app/lib/routes/voteRoute";

export const runtime = "nodejs";

export const POST = createVoteHandler({
  requireUser: getBrowserUser,
});
