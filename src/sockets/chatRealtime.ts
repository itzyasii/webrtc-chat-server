import type { Server, Socket } from "socket.io";
import { z } from "zod";
import mongoose from "mongoose";
import { ChatModel } from "../models/Chat";
import { MessageModel } from "../models/Message";
import { UserModel } from "../models/User";
import { emitToUser } from "./store";

const ObjectIdString = z.string().regex(/^[a-fA-F0-9]{24}$/);

const TypingSchema = z.object({
  chatId: ObjectIdString,
  isTyping: z.boolean(),
});

const ReceiptSchema = z.object({
  messageIds: z.array(ObjectIdString).min(1).max(200),
});

const VoiceListenedSchema = z.object({
  messageId: ObjectIdString,
});

const ReactionSchema = z.object({
  messageId: ObjectIdString,
  // Emojis can be multi-codepoint (skin tones/ZWJ sequences), so keep this lenient.
  emoji: z.string().min(1).max(64),
});

export function registerChatRealtimeHandlers(
  io: Server,
  socket: Socket,
  userId: string,
) {
  socket.on("presence:ping", async () => {
    await UserModel.updateOne(
      { _id: userId },
      { $set: { lastSeenAt: new Date() } },
    ).exec();
  });

  socket.on(
    "chat:typing",
    async (data: unknown, ack?: (res: { ok: boolean }) => void) => {
      try {
        const parsed = TypingSchema.parse(data);
        const chat = await ChatModel.findOne({
          _id: parsed.chatId,
          members: userId,
        })
          .select("members")
          .lean();
        if (!chat || chat.members.length !== 2) return ack?.({ ok: false });

        const other = chat.members.map(String).find((m) => m !== userId);
        if (!other) return ack?.({ ok: false });

        const emitted = emitToUser(io, other, "chat:typing", {
          ok: true,
          chatId: parsed.chatId,
          from: userId,
          isTyping: parsed.isTyping,
        });
        ack?.({ ok: emitted });
      } catch {
        ack?.({ ok: false });
      }
    },
  );

  socket.on(
    "chat:delivered",
    async (data: unknown, ack?: (res: { ok: boolean }) => void) => {
      try {
        const parsed = ReceiptSchema.parse(data);
        const now = new Date();
        const uid = new mongoose.Types.ObjectId(userId);

        const ids = parsed.messageIds.map(
          (id) => new mongoose.Types.ObjectId(id),
        );

        await MessageModel.updateMany(
          { _id: { $in: ids }, "receipts.userId": uid },
          { $set: { "receipts.$.deliveredAt": now } },
        ).exec();

        await MessageModel.updateMany(
          {
            _id: { $in: ids },
            receipts: { $not: { $elemMatch: { userId: uid } } },
          },
          { $push: { receipts: { userId: uid, deliveredAt: now } } },
        ).exec();

        const msgs = await MessageModel.find({ _id: { $in: ids } })
          .select("from chatId")
          .lean();
        for (const m of msgs) {
          const fromId = String(m.from);
          if (fromId !== userId) {
            emitToUser(io, fromId, "chat:receipt", {
              ok: true,
              type: "delivered",
              messageIds: parsed.messageIds,
              userId,
              chatId: String(m.chatId),
              at: now.toISOString(),
            });
          }
        }

        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    },
  );

  socket.on(
    "chat:read",
    async (data: unknown, ack?: (res: { ok: boolean }) => void) => {
      try {
        const parsed = ReceiptSchema.parse(data);
        const now = new Date();
        const uid = new mongoose.Types.ObjectId(userId);

        const ids = parsed.messageIds.map(
          (id) => new mongoose.Types.ObjectId(id),
        );

        await MessageModel.updateMany(
          { _id: { $in: ids }, "receipts.userId": uid },
          { $set: { "receipts.$.readAt": now, "receipts.$.deliveredAt": now } },
        ).exec();

        await MessageModel.updateMany(
          {
            _id: { $in: ids },
            receipts: { $not: { $elemMatch: { userId: uid } } },
          },
          {
            $push: { receipts: { userId: uid, deliveredAt: now, readAt: now } },
          },
        ).exec();

        const msgs = await MessageModel.find({ _id: { $in: ids } })
          .select("from chatId")
          .lean();
        for (const m of msgs) {
          const fromId = String(m.from);
          if (fromId !== userId) {
            emitToUser(io, fromId, "chat:receipt", {
              ok: true,
              type: "read",
              messageIds: parsed.messageIds,
              userId,
              chatId: String(m.chatId),
              at: now.toISOString(),
            });
          }
        }

        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    },
  );

  socket.on(
    "chat:voice:listened",
    async (data: unknown, ack?: (res: { ok: boolean; error?: string }) => void) => {
      try {
        const parsed = VoiceListenedSchema.safeParse(data);
        if (!parsed.success) return ack?.({ ok: false, error: "InvalidPayload" });

        const uid = new mongoose.Types.ObjectId(userId);
        const now = new Date();
        const message = await MessageModel.findById(parsed.data.messageId)
          .select("chatId from type item deletedAt")
          .lean();
        if (!message || message.deletedAt)
          return ack?.({ ok: false, error: "MessageNotFound" });
        if (String(message.from) === userId)
          return ack?.({ ok: false, error: "OwnMessage" });
        if (message.type !== "share" || message.item?.kind !== "audio")
          return ack?.({ ok: false, error: "NotVoiceMessage" });

        const chat = await ChatModel.findOne({
          _id: message.chatId,
          members: userId,
        })
          .select("members")
          .lean();
        if (!chat || chat.members.length !== 2)
          return ack?.({ ok: false, error: "Forbidden" });

        const updateExisting = await MessageModel.updateOne(
          {
            _id: message._id,
            receipts: { $elemMatch: { userId: uid, listenedAt: { $exists: false } } },
          },
          {
            $set: {
              "receipts.$.deliveredAt": now,
              "receipts.$.readAt": now,
              "receipts.$.listenedAt": now,
            },
          },
        ).exec();

        if (updateExisting.modifiedCount === 0) {
          await MessageModel.updateOne(
            {
              _id: message._id,
              receipts: { $not: { $elemMatch: { userId: uid } } },
            },
            {
              $push: {
                receipts: {
                  userId: uid,
                  deliveredAt: now,
                  readAt: now,
                  listenedAt: now,
                },
              },
            },
          ).exec();
        }

        emitToUser(io, String(message.from), "chat:voice:listened", {
          ok: true,
          chatId: String(message.chatId),
          messageId: parsed.data.messageId,
          userId,
          at: now.toISOString(),
        });

        emitToUser(io, String(message.from), "chat:receipt", {
          ok: true,
          type: "read",
          chatId: String(message.chatId),
          messageIds: [parsed.data.messageId],
          userId,
          at: now.toISOString(),
        });

        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: "ServerError" });
      }
    },
  );

  socket.on(
    "chat:react",
    async (
      data: unknown,
      ack?: (res: {
        ok: boolean;
        action?: "added" | "removed";
        user?: {
          id: string;
          username?: string;
          email?: string;
        };
        error?: string;
      }) => void,
    ) => {
      try {
        const parsed = ReactionSchema.safeParse(data);
        if (!parsed.success)
          return ack?.({ ok: false, error: "InvalidPayload" });
        const uid = new mongoose.Types.ObjectId(userId);
        const mid = new mongoose.Types.ObjectId(parsed.data.messageId);
        const now = new Date();

        const msg = await MessageModel.findById(mid).select("chatId").lean();
        if (!msg) return ack?.({ ok: false, error: "MessageNotFound" });

        const chat = await ChatModel.findOne({
          _id: msg.chatId,
          members: userId,
        })
          .select("members")
          .lean();
        if (!chat || chat.members.length !== 2)
          return ack?.({ ok: false, error: "Forbidden" });

        const removeQuery = {
          _id: mid,
          reactions: {
            $elemMatch: { userId: uid, emoji: parsed.data.emoji },
          },
        };

        const pullRes = await MessageModel.updateOne(removeQuery, {
          $pull: { reactions: { userId: uid, emoji: parsed.data.emoji } },
        }).exec();

        const removed = pullRes.matchedCount > 0;
        let action: "added" | "removed" = "removed";
        if (!removed) {
          const pushRes = await MessageModel.updateOne(
            {
              _id: mid,
              reactions: {
                $not: {
                  $elemMatch: { userId: uid, emoji: parsed.data.emoji },
                },
              },
            },
            {
              $push: {
                reactions: {
                  userId: uid,
                  emoji: parsed.data.emoji,
                  createdAt: now,
                },
              },
            },
          ).exec();

          action = pushRes.modifiedCount > 0 ? "added" : "removed";
        }

        const reactionUser = await UserModel.findById(userId)
          .select("_id username email")
          .lean();

        const members = chat.members.map(String);
        for (const id of members) {
          emitToUser(io, id, "chat:reaction", {
            ok: true,
            chatId: String(msg.chatId),
            messageId: parsed.data.messageId,
            emoji: parsed.data.emoji,
            userId,
            user: reactionUser
              ? {
                  id: String(reactionUser._id),
                  username: reactionUser.username,
                  email: reactionUser.email,
                }
              : { id: userId },
            action,
            at: now.toISOString(),
          });
        }

        ack?.({
          ok: true,
          action,
          user: reactionUser
            ? {
                id: String(reactionUser._id),
                username: reactionUser.username,
                email: reactionUser.email,
              }
            : { id: userId },
        });
      } catch {
        ack?.({ ok: false, error: "ServerError" });
      }
    },
  );
}

export async function deliverPendingMessages(io: Server, userId: string) {
  const uid = new mongoose.Types.ObjectId(userId);
  const pending = await MessageModel.find({
    from: { $ne: uid },
    deletedAt: { $exists: false },
    $or: [
      { receipts: { $not: { $elemMatch: { userId: uid } } } },
      { receipts: { $elemMatch: { userId: uid, deliveredAt: { $exists: false } } } },
    ],
  })
    .select("_id chatId from")
    .lean();

  if (!pending.length) return;

  const chatIds = Array.from(new Set(pending.map((message) => String(message.chatId))));
  const chats = await ChatModel.find({
    _id: { $in: chatIds },
    members: userId,
  })
    .select("_id")
    .lean();
  const allowedChatIds = new Set(chats.map((chat) => String(chat._id)));
  const messages = pending.filter((message) => allowedChatIds.has(String(message.chatId)));
  if (!messages.length) return;

  const ids = messages.map((message) => new mongoose.Types.ObjectId(String(message._id)));
  const now = new Date();

  await MessageModel.updateMany(
    {
      _id: { $in: ids },
      receipts: { $elemMatch: { userId: uid, deliveredAt: { $exists: false } } },
    },
    { $set: { "receipts.$.deliveredAt": now } },
  ).exec();

  await MessageModel.updateMany(
    {
      _id: { $in: ids },
      receipts: { $not: { $elemMatch: { userId: uid } } },
    },
    { $push: { receipts: { userId: uid, deliveredAt: now } } },
  ).exec();

  const grouped = new Map<string, { fromId: string; chatId: string; messageIds: string[] }>();
  for (const message of messages) {
    const fromId = String(message.from);
    const chatId = String(message.chatId);
    const key = `${fromId}:${chatId}`;
    const current = grouped.get(key);
    if (current) {
      current.messageIds.push(String(message._id));
      continue;
    }
    grouped.set(key, {
      fromId,
      chatId,
      messageIds: [String(message._id)],
    });
  }

  for (const receipt of grouped.values()) {
    emitToUser(io, receipt.fromId, "chat:receipt", {
      ok: true,
      type: "delivered",
      messageIds: receipt.messageIds,
      userId,
      chatId: receipt.chatId,
      at: now.toISOString(),
    });
  }
}
