import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { CallLogModel } from "../models/CallLog";

export const callsRouter = Router();

const ObjectIdString = z.string().regex(/^[a-fA-F0-9]{24}$/);

callsRouter.get("/calls", requireAuth, async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : "";
  const cursorOk = cursor ? ObjectIdString.safeParse(cursor).success : false;
  const status = typeof req.query.status === "string" ? req.query.status : "";

  const query: any = {
    $or: [{ callerId: req.user!.id }, { calleeId: req.user!.id }],
  };
  if (cursorOk) query._id = { $lt: cursor };
  if (status) query.status = status;

  const logsDesc = await CallLogModel.find(query).sort({ _id: -1 }).limit(limit + 1).lean();
  const hasMore = logsDesc.length > limit;
  const page = hasMore ? logsDesc.slice(0, limit) : logsDesc;
  const nextCursor = hasMore ? String(page[page.length - 1]!._id) : null;

  res.json({
    ok: true,
    nextCursor,
    calls: page.map((c) => ({
      id: String(c._id),
      callId: c.callId,
      callerId: String(c.callerId),
      calleeId: String(c.calleeId),
      status: c.status,
      offeredAt: c.offeredAt,
      answeredAt: c.answeredAt ?? null,
      endedAt: c.endedAt ?? null,
      endedBy: c.endedBy ? String(c.endedBy) : null,
      reason: c.reason ?? null,
    })),
  });
});
