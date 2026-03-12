import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { validateBody } from "../middlewares/validate";
import { UserModel } from "../models/User";
import { listOnlineUsers } from "../sockets/store";
import { BlockModel } from "../models/Block";
import { ReportModel } from "../models/Report";

export const usersRouter = Router();

const ObjectIdString = z.string().regex(/^[a-fA-F0-9]{24}$/);

async function isBlockedEitherWay(a: string, b: string) {
  const existing = await BlockModel.findOne({
    $or: [
      { blockerId: a, blockedId: b },
      { blockerId: b, blockedId: a },
    ],
  })
    .select("_id")
    .lean();
  return Boolean(existing);
}

usersRouter.get("/users/presence", requireAuth, async (req, res) => {
  const idsParam = typeof req.query.ids === "string" ? req.query.ids : "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ObjectIdString.safeParse(s).success)
    .slice(0, 200);

  if (ids.length === 0) return res.json({ ok: true, presence: [] });

  const users = await UserModel.find({ _id: { $in: ids } })
    .select("_id lastSeenAt")
    .lean();
  const lastSeenMap = new Map(users.map((u) => [String(u._id), u.lastSeenAt]));
  const online = new Set(listOnlineUsers());

  res.json({
    ok: true,
    presence: ids.map((id) => ({
      userId: id,
      isOnline: online.has(id),
      lastSeenAt: lastSeenMap.get(id)?.toISOString() ?? null,
    })),
  });
});

usersRouter.get("/users/search", requireAuth, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) return res.json({ ok: true, users: [] });

  const users = await UserModel.find({
    $or: [
      { username: { $regex: q, $options: "i" } },
      { email: { $regex: q, $options: "i" } },
    ],
  })
    .select("_id email username")
    .limit(20)
    .lean();

  res.json({
    ok: true,
    users: users.map((u) => ({
      id: String(u._id),
      email: u.email,
      username: u.username,
    })),
  });
});

usersRouter.get("/users/friends", requireAuth, async (req, res) => {
  const me = await UserModel.findById(req.user!.id).select("friends").lean();
  if (!me) return res.status(404).json({ ok: false, error: "NotFound" });

  const friends = await UserModel.find({ _id: { $in: me.friends } })
    .select("_id email username")
    .lean();

  res.json({
    ok: true,
    friends: friends.map((u) => ({
      id: String(u._id),
      email: u.email,
      username: u.username,
    })),
  });
});

usersRouter.get("/users/friends/requests", requireAuth, async (req, res) => {
  const me = await UserModel.findById(req.user!.id)
    .select("incomingFriendRequests outgoingFriendRequests")
    .lean();
  if (!me) return res.status(404).json({ ok: false, error: "NotFound" });

  const incoming = await UserModel.find({
    _id: { $in: me.incomingFriendRequests },
  })
    .select("_id email username")
    .lean();
  const outgoing = await UserModel.find({
    _id: { $in: me.outgoingFriendRequests },
  })
    .select("_id email username")
    .lean();

  res.json({
    ok: true,
    incoming: incoming.map((u) => ({
      id: String(u._id),
      email: u.email,
      username: u.username,
    })),
    outgoing: outgoing.map((u) => ({
      id: String(u._id),
      email: u.email,
      username: u.username,
    })),
  });
});

const RequestSchema = z.object({ toUserId: ObjectIdString });

usersRouter.post(
  "/users/friends/request",
  requireAuth,
  validateBody(RequestSchema),
  async (req, res) => {
    const { toUserId } = req.body as z.infer<typeof RequestSchema>;
    const meId = req.user!.id;
    if (toUserId === meId)
      return res.status(400).json({ ok: false, error: "InvalidTarget" });
    if (await isBlockedEitherWay(meId, toUserId))
      return res.status(403).json({ ok: false, error: "Blocked" });

    const [me, target] = await Promise.all([
      UserModel.findById(meId)
        .select("friends incomingFriendRequests outgoingFriendRequests")
        .lean(),
      UserModel.findById(toUserId).select("_id").lean(),
    ]);
    if (!me || !target)
      return res.status(404).json({ ok: false, error: "NotFound" });

    const alreadyFriends = me.friends.some((id) => String(id) === toUserId);
    if (alreadyFriends)
      return res.status(409).json({ ok: false, error: "AlreadyFriends" });

    const alreadyOutgoing = me.outgoingFriendRequests.some(
      (id) => String(id) === toUserId,
    );
    if (alreadyOutgoing)
      return res.status(409).json({ ok: false, error: "AlreadyRequested" });

    const alreadyIncoming = me.incomingFriendRequests.some(
      (id) => String(id) === toUserId,
    );
    if (alreadyIncoming)
      return res
        .status(409)
        .json({ ok: false, error: "IncomingRequestExists" });

    await Promise.all([
      UserModel.updateOne(
        { _id: meId },
        { $addToSet: { outgoingFriendRequests: toUserId } },
      ).exec(),
      UserModel.updateOne(
        { _id: toUserId },
        { $addToSet: { incomingFriendRequests: meId } },
      ).exec(),
    ]);

    res.status(201).json({ ok: true });
  },
);

const AcceptSchema = z.object({ fromUserId: ObjectIdString });

usersRouter.post(
  "/users/friends/accept",
  requireAuth,
  validateBody(AcceptSchema),
  async (req, res) => {
    const { fromUserId } = req.body as z.infer<typeof AcceptSchema>;
    const meId = req.user!.id;
    if (fromUserId === meId)
      return res.status(400).json({ ok: false, error: "InvalidTarget" });
    if (await isBlockedEitherWay(meId, fromUserId))
      return res.status(403).json({ ok: false, error: "Blocked" });

    const me = await UserModel.findById(meId)
      .select("incomingFriendRequests friends")
      .lean();
    if (!me) return res.status(404).json({ ok: false, error: "NotFound" });

    const hasRequest = me.incomingFriendRequests.some(
      (id) => String(id) === fromUserId,
    );
    if (!hasRequest)
      return res.status(409).json({ ok: false, error: "NoIncomingRequest" });

    await Promise.all([
      UserModel.updateOne(
        { _id: meId },
        {
          $pull: { incomingFriendRequests: fromUserId },
          $addToSet: { friends: fromUserId },
        },
      ).exec(),
      UserModel.updateOne(
        { _id: fromUserId },
        {
          $pull: { outgoingFriendRequests: meId },
          $addToSet: { friends: meId },
        },
      ).exec(),
    ]);

    res.json({ ok: true });
  },
);

usersRouter.post(
  "/users/friends/reject",
  requireAuth,
  validateBody(AcceptSchema),
  async (req, res) => {
    const { fromUserId } = req.body as z.infer<typeof AcceptSchema>;
    const meId = req.user!.id;

    await Promise.all([
      UserModel.updateOne(
        { _id: meId },
        { $pull: { incomingFriendRequests: fromUserId } },
      ).exec(),
      UserModel.updateOne(
        { _id: fromUserId },
        { $pull: { outgoingFriendRequests: meId } },
      ).exec(),
    ]);

    res.json({ ok: true });
  },
);

const CancelSchema = z.object({ toUserId: ObjectIdString });

usersRouter.post(
  "/users/friends/cancel",
  requireAuth,
  validateBody(CancelSchema),
  async (req, res) => {
    const { toUserId } = req.body as z.infer<typeof CancelSchema>;
    const meId = req.user!.id;

    await Promise.all([
      UserModel.updateOne(
        { _id: meId },
        { $pull: { outgoingFriendRequests: toUserId } },
      ).exec(),
      UserModel.updateOne(
        { _id: toUserId },
        { $pull: { incomingFriendRequests: meId } },
      ).exec(),
    ]);

    res.json({ ok: true });
  },
);

const UnfriendSchema = z.object({ userId: ObjectIdString });

usersRouter.post(
  "/users/friends/unfriend",
  requireAuth,
  validateBody(UnfriendSchema),
  async (req, res) => {
    const { userId } = req.body as z.infer<typeof UnfriendSchema>;
    const meId = req.user!.id;

    await Promise.all([
      UserModel.updateOne({ _id: meId }, { $pull: { friends: userId } }).exec(),
      UserModel.updateOne({ _id: userId }, { $pull: { friends: meId } }).exec(),
    ]);

    res.json({ ok: true });
  },
);

const BlockSchema = z.object({
  userId: ObjectIdString,
  reason: z.string().max(500).optional(),
});

usersRouter.post(
  "/users/block",
  requireAuth,
  validateBody(BlockSchema),
  async (req, res) => {
    const { userId, reason } = req.body as z.infer<typeof BlockSchema>;
    const meId = req.user!.id;
    if (userId === meId)
      return res.status(400).json({ ok: false, error: "InvalidTarget" });

    await BlockModel.updateOne(
      { blockerId: meId, blockedId: userId },
      { $set: { blockerId: meId, blockedId: userId, reason } },
      { upsert: true },
    ).exec();

    await Promise.all([
      UserModel.updateOne(
        { _id: meId },
        {
          $pull: {
            friends: userId,
            outgoingFriendRequests: userId,
            incomingFriendRequests: userId,
          },
        },
      ).exec(),
      UserModel.updateOne(
        { _id: userId },
        {
          $pull: {
            friends: meId,
            outgoingFriendRequests: meId,
            incomingFriendRequests: meId,
          },
        },
      ).exec(),
    ]);

    res.json({ ok: true });
  },
);

usersRouter.post(
  "/users/unblock",
  requireAuth,
  validateBody(UnfriendSchema),
  async (req, res) => {
    const { userId } = req.body as z.infer<typeof UnfriendSchema>;
    const meId = req.user!.id;
    await BlockModel.deleteOne({ blockerId: meId, blockedId: userId }).exec();
    res.json({ ok: true });
  },
);

const ReportSchema = z.object({
  userId: ObjectIdString,
  reason: z.string().min(3).max(200),
  details: z.string().max(2000).optional(),
});

usersRouter.post(
  "/users/report",
  requireAuth,
  validateBody(ReportSchema),
  async (req, res) => {
    const { userId, reason, details } = req.body as z.infer<
      typeof ReportSchema
    >;
    const meId = req.user!.id;
    if (userId === meId)
      return res.status(400).json({ ok: false, error: "InvalidTarget" });

    await ReportModel.create({
      reporterId: meId,
      targetUserId: userId,
      reason,
      details,
    });

    res.status(201).json({ ok: true });
  },
);
