import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { requireAuth } from "../middlewares/requireAuth";
import { validateBody } from "../middlewares/validate";
import { ChatModel } from "../models/Chat";
import { MessageModel } from "../models/Message";
import { UserModel } from "../models/User";

export const chatsRouter = Router();

const ObjectIdString = z.string().regex(/^[a-fA-F0-9]{24}$/);

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

    const other = await UserModel.findById(userId).select("_id").lean();
    if (!other) return res.status(404).json({ ok: false, error: "NotFound" });

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
  const before =
    typeof req.query.before === "string"
      ? new Date(req.query.before)
      : undefined;
  const beforeValid = before && !Number.isNaN(before.getTime());

  const chat = await ChatModel.findOne({
    _id: chatId,
    members: req.user!.id,
  }).lean();
  if (!chat) return res.status(404).json({ ok: false, error: "NotFound" });

  const query: any = { chatId };
  if (beforeValid) query.createdAt = { $lt: before };

  const messages = await MessageModel.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  res.json({
    ok: true,
    messages: messages.reverse().map((m) => ({
      id: String(m._id),
      chatId: String(m.chatId),
      from: String(m.from),
      type: m.type,
      text: m.text,
      item: m.item,
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
        createdAt: message.createdAt,
      },
    });
  },
);
