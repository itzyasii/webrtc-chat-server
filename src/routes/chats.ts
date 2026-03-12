import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { requireAuth } from "../middlewares/requireAuth";
import { validateBody } from "../middlewares/validate";
import { BlockModel } from "../models/Block";
import { ChatModel } from "../models/Chat";
import { MessageModel } from "../models/Message";
import { UserModel } from "../models/User";

export const chatsRouter = Router();

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

chatsRouter.get("/chats", requireAuth, async (req, res) => {
  const meId = new mongoose.Types.ObjectId(req.user!.id);
  const chats = await ChatModel.find({ members: meId })
    .sort({ updatedAt: -1 })
    .lean();

  const memberIds = Array.from(
    new Set(chats.flatMap((c) => c.members.map((id) => String(id)))),
  );
  const members = await UserModel.find({ _id: { $in: memberIds } })
    .select("_id email username")
    .lean();
  const memberMap = new Map(
    members.map((m) => [
      String(m._id),
      { id: String(m._id), email: m.email, username: m.username },
    ]),
  );

  res.json({
    ok: true,
    chats: chats.map((c) => ({
      id: String(c._id),
      type: c.type,
      members: c.members.map(
        (id) => memberMap.get(String(id)) ?? { id: String(id) },
      ),
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
    })),
  });
});

const CreateDmSchema = z.object({ userId: ObjectIdString });

chatsRouter.post(
  "/chats/dm",
  requireAuth,
  validateBody(CreateDmSchema),
  async (req, res) => {
    const { userId } = req.body as z.infer<typeof CreateDmSchema>;
    const meId = req.user!.id;
    if (userId === meId)
      return res.status(400).json({ ok: false, error: "InvalidTarget" });
    if (await isBlockedEitherWay(meId, userId))
      return res.status(403).json({ ok: false, error: "Blocked" });

    const [me, other] = await Promise.all([
      UserModel.findById(meId).select("friends").lean(),
      UserModel.findById(userId).select("_id").lean(),
    ]);
    if (!me) return res.status(404).json({ ok: false, error: "NotFound" });
    if (!other) return res.status(404).json({ ok: false, error: "NotFound" });

    const isFriend = me.friends.some((id) => String(id) === userId);
    if (!isFriend) return res.status(403).json({ ok: false, error: "NotFriends" });

    const existing = await ChatModel.findOne({
      type: "dm",
      members: { $all: [meId, userId] },
    }).lean();
    if (existing && existing.members.length === 2) {
      return res.json({ ok: true, chat: { id: String(existing._id) } });
    }

    const chat = await ChatModel.create({
      type: "dm",
      members: [meId, userId],
    });

    res.status(201).json({ ok: true, chat: { id: String(chat._id) } });
  },
);

chatsRouter.get("/chats/:chatId/messages", requireAuth, async (req, res) => {
  const { chatId } = req.params;
  if (!ObjectIdString.safeParse(chatId).success)
    return res.status(400).json({ ok: false, error: "InvalidChatId" });

  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : "";
  const cursorOk = cursor ? ObjectIdString.safeParse(cursor).success : false;
  const before = typeof req.query.before === "string" ? new Date(req.query.before) : undefined;
  const beforeValid = before && !Number.isNaN(before.getTime());

  const chat = await ChatModel.findOne({
    _id: chatId,
    members: req.user!.id,
  }).lean();
  if (!chat) return res.status(404).json({ ok: false, error: "NotFound" });

  const query: any = { chatId };
  if (cursorOk) query._id = { $lt: cursor };
  else if (beforeValid) query.createdAt = { $lt: before };

  const messagesDesc = await MessageModel.find(query)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = messagesDesc.length > limit;
  const page = hasMore ? messagesDesc.slice(0, limit) : messagesDesc;
  const nextCursor = hasMore ? String(page[page.length - 1]!._id) : null;

  res.json({
    ok: true,
    nextCursor,
    messages: page
      .slice()
      .reverse()
      .map((m) => ({
        id: String(m._id),
        chatId: String(m.chatId),
        from: String(m.from),
        type: m.type,
        clientMessageId: m.clientMessageId ?? null,
        text: m.deletedAt ? null : m.text ?? null,
        item: m.deletedAt ? null : m.item ?? null,
        receipts: m.receipts ?? [],
        editedAt: m.editedAt ?? null,
        deletedAt: m.deletedAt ?? null,
        createdAt: m.createdAt,
      })),
  });
});

const ShareItemSchema = z.object({
  kind: z.enum(["file", "image", "video", "audio"]),
  url: z.string().min(1),
  originalName: z.string().min(1).optional(),
  mime: z.string().min(1).optional(),
  size: z.number().int().nonnegative().optional(),
  meta: z.record(z.unknown()).optional(),
});

const SendMessageSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string().min(1).max(4000) }),
  z.object({ type: z.literal("share"), item: ShareItemSchema }),
]);

chatsRouter.post(
  "/chats/:chatId/messages",
  requireAuth,
  validateBody(SendMessageSchema),
  async (req, res) => {
    const { chatId } = req.params;
    if (!ObjectIdString.safeParse(chatId).success)
      return res.status(400).json({ ok: false, error: "InvalidChatId" });

    const chat = await ChatModel.findOne({
      _id: chatId,
      members: req.user!.id,
    }).lean();
    if (!chat) return res.status(404).json({ ok: false, error: "NotFound" });
    if (chat.members.length === 2) {
      const other = chat.members.map(String).find((m) => m !== req.user!.id);
      if (other) {
        if (await isBlockedEitherWay(req.user!.id, other))
          return res.status(403).json({ ok: false, error: "Blocked" });
      }
    }

    const body = req.body as z.infer<typeof SendMessageSchema>;
    const doc =
      body.type === "text"
        ? { chatId, from: req.user!.id, type: "text" as const, text: body.text }
        : {
            chatId,
            from: req.user!.id,
            type: "share" as const,
            item: body.item,
          };

    const message = await MessageModel.create(doc);
    await ChatModel.updateOne(
      { _id: chatId },
      { $set: { updatedAt: new Date() } },
    ).exec();

    res.status(201).json({
      ok: true,
      message: {
        id: String(message._id),
        chatId: String(message.chatId),
        from: String(message.from),
        type: message.type,
        text: message.text,
        item: message.item,
        receipts: message.receipts ?? [],
        editedAt: message.editedAt ?? null,
        deletedAt: message.deletedAt ?? null,
        createdAt: message.createdAt,
      },
    });
  },
);

const EditSchema = z.object({ text: z.string().min(1).max(4000) });

chatsRouter.patch(
  "/chats/:chatId/messages/:messageId",
  requireAuth,
  validateBody(EditSchema),
  async (req, res) => {
    const { chatId, messageId } = req.params;
    if (!ObjectIdString.safeParse(chatId).success || !ObjectIdString.safeParse(messageId).success) {
      return res.status(400).json({ ok: false, error: "InvalidId" });
    }

    const msg = await MessageModel.findOne({ _id: messageId, chatId }).select("from type deletedAt").lean();
    if (!msg) return res.status(404).json({ ok: false, error: "NotFound" });
    if (String(msg.from) !== req.user!.id) return res.status(403).json({ ok: false, error: "Forbidden" });
    if (msg.deletedAt) return res.status(409).json({ ok: false, error: "MessageDeleted" });
    if (msg.type !== "text") return res.status(409).json({ ok: false, error: "NotEditable" });

    await MessageModel.updateOne(
      { _id: messageId },
      { $set: { text: (req.body as any).text, editedAt: new Date() } },
    ).exec();

    res.json({ ok: true });
  },
);

chatsRouter.delete("/chats/:chatId/messages/:messageId", requireAuth, async (req, res) => {
  const { chatId, messageId } = req.params;
  if (!ObjectIdString.safeParse(chatId).success || !ObjectIdString.safeParse(messageId).success) {
    return res.status(400).json({ ok: false, error: "InvalidId" });
  }

  const msg = await MessageModel.findOne({ _id: messageId, chatId }).select("from deletedAt").lean();
  if (!msg) return res.status(404).json({ ok: false, error: "NotFound" });
  if (String(msg.from) !== req.user!.id) return res.status(403).json({ ok: false, error: "Forbidden" });
  if (msg.deletedAt) return res.json({ ok: true });

  await MessageModel.updateOne(
    { _id: messageId },
    { $set: { deletedAt: new Date() }, $unset: { text: 1, item: 1 } },
  ).exec();

  res.json({ ok: true });
});
