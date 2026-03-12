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

        emitToUser(io, other, "chat:typing", {
          ok: true,
          chatId: parsed.chatId,
          from: userId,
          isTyping: parsed.isTyping,
        });
        ack?.({ ok: true });
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
}
