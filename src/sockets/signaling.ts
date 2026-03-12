import type { Server, Socket } from "socket.io";
import { z } from "zod";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { emitToUser, listOnlineUsers } from "./store";
import { ChatModel } from "../models/Chat";
import { MessageModel } from "../models/Message";
import { UserModel } from "../models/User";
import { BlockModel } from "../models/Block";
import { CallLogModel } from "../models/CallLog";
import { env } from "../config/env";

const ObjectIdString = z.string().regex(/^[a-fA-F0-9]{24}$/);

const RtcSessionDescription = z.object({
  type: z.string().min(1),
  sdp: z.string().optional(),
});

const IceCandidate = z.object({
  candidate: z.string().optional(),
  sdpMid: z.string().optional(),
  sdpMLineIndex: z.number().optional(),
  usernameFragment: z.string().optional(),
});

const CallOfferSchema = z.object({
  to: ObjectIdString,
  callId: z.string().min(1).optional(),
  media: z.enum(["audio", "video"]).optional(),
  offer: RtcSessionDescription,
});

const CallAnswerSchema = z.object({
  to: ObjectIdString,
  callId: z.string().min(1),
  answer: RtcSessionDescription,
});

const CallIceSchema = z.object({
  to: ObjectIdString,
  callId: z.string().min(1),
  candidate: IceCandidate,
});

const CallEndSchema = z.object({
  to: ObjectIdString,
  callId: z.string().min(1),
  reason: z.string().optional(),
});

const ChatMessageSchema = z.object({
  to: ObjectIdString,
  clientMessageId: z.string().min(1).max(100).optional(),
  text: z.string().min(1).max(4000),
});

const ShareItemSchema = z.object({
  kind: z.enum(["file", "image", "video", "audio"]),
  url: z.string().min(1),
  originalName: z.string().min(1).optional(),
  mime: z.string().min(1).optional(),
  size: z.number().int().nonnegative().optional(),
  meta: z.record(z.unknown()).optional(),
});

const ShareSchema = z.object({
  to: ObjectIdString,
  clientMessageId: z.string().min(1).max(100).optional(),
  item: ShareItemSchema,
});

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

async function getOrCreateDmChat(userA: string, userB: string) {
  const existing = await ChatModel.findOne({
    type: "dm",
    members: { $all: [userA, userB] },
  }).lean();

  if (existing && existing.members.length === 2) return existing;

  const created = await ChatModel.create({
    type: "dm",
    members: [userA, userB],
  });

  return created.toObject();
}

const ringTimers = new Map<string, NodeJS.Timeout>();

function clearRingTimer(callId: string) {
  const t = ringTimers.get(callId);
  if (t) clearTimeout(t);
  ringTimers.delete(callId);
}

function scheduleMissedCall(io: Server, callId: string, callerId: string, calleeId: string) {
  clearRingTimer(callId);

  const timeoutMs = env.CALL_RING_TIMEOUT_SECONDS * 1000;
  const t = setTimeout(async () => {
    try {
      const now = new Date();

      const updated = await CallLogModel.findOneAndUpdate(
        { callId, status: "ringing", answeredAt: { $exists: false }, endedAt: { $exists: false } },
        { $set: { status: "missed", endedAt: now, reason: "timeout" } },
        { new: true },
      ).lean();

      if (!updated) return;

      emitToUser(io, calleeId, "call:missed", {
        ok: true,
        callId,
        from: callerId,
        at: now.toISOString(),
      });

      emitToUser(io, callerId, "call:end", {
        ok: true,
        to: calleeId,
        callId,
        reason: "timeout",
      });

      emitToUser(io, calleeId, "call:end", {
        ok: true,
        to: callerId,
        callId,
        reason: "timeout",
      });
    } finally {
      clearRingTimer(callId);
    }
  }, timeoutMs);

  ringTimers.set(callId, t);
}

export function registerSignalingHandlers(io: Server, socket: Socket, userId: string) {
  socket.on(
    "presence:list",
    (ack?: (res: { ok: true; users: string[] }) => void) => {
      if (ack) ack({ ok: true, users: listOnlineUsers() });
    },
  );

  socket.on(
    "call:offer",
    async (data: unknown, ack?: (res: { ok: boolean; callId?: string }) => void) => {
      const parsed = CallOfferSchema.safeParse(data);
      if (!parsed.success) return ack?.({ ok: false });
      if (await isBlockedEitherWay(userId, parsed.data.to)) return ack?.({ ok: false });

      const callId = parsed.data.callId ?? nanoid(16);
      const now = new Date();

      await CallLogModel.updateOne(
        { callId },
        {
          $setOnInsert: {
            callId,
            callerId: new mongoose.Types.ObjectId(userId),
            calleeId: new mongoose.Types.ObjectId(parsed.data.to),
            status: "ringing",
            offeredAt: now,
          },
        },
        { upsert: true },
      ).exec();

      const ok = emitToUser(io, parsed.data.to, "call:offer", {
        from: userId,
        to: parsed.data.to,
        callId,
        media: parsed.data.media ?? "video",
        offer: parsed.data.offer,
      });

      scheduleMissedCall(io, callId, userId, parsed.data.to);
      ack?.({ ok, callId });
    },
  );

  socket.on(
    "call:answer",
    async (data: unknown, ack?: (res: { ok: boolean }) => void) => {
      const parsed = CallAnswerSchema.safeParse(data);
      if (!parsed.success) return ack?.({ ok: false });

      clearRingTimer(parsed.data.callId);
      await CallLogModel.updateOne(
        { callId: parsed.data.callId },
        { $set: { status: "answered", answeredAt: new Date() } },
      ).exec();

      const ok = emitToUser(io, parsed.data.to, "call:answer", {
        from: userId,
        ...parsed.data,
      });
      ack?.({ ok });
    },
  );

  socket.on(
    "call:ice-candidate",
    (data: unknown, ack?: (res: { ok: boolean }) => void) => {
      const parsed = CallIceSchema.safeParse(data);
      if (!parsed.success) return ack?.({ ok: false });
      const ok = emitToUser(io, parsed.data.to, "call:ice-candidate", {
        from: userId,
        ...parsed.data,
      });
      ack?.({ ok });
    },
  );

  socket.on(
    "call:end",
    async (data: unknown, ack?: (res: { ok: boolean }) => void) => {
      const parsed = CallEndSchema.safeParse(data);
      if (!parsed.success) return ack?.({ ok: false });

      clearRingTimer(parsed.data.callId);
      const existing = await CallLogModel.findOne({
        callId: parsed.data.callId,
      }).lean();
      const now = new Date();

      if (existing) {
        const wasAnswered = Boolean(existing.answeredAt);
        const status = wasAnswered
          ? "ended"
          : parsed.data.reason === "timeout" || parsed.data.reason === "missed"
            ? "missed"
            : String(existing.calleeId) === userId
              ? "declined"
              : "cancelled";

        await CallLogModel.updateOne(
          { callId: parsed.data.callId },
          {
            $set: {
              status,
              endedAt: now,
              endedBy: new mongoose.Types.ObjectId(userId),
              reason: parsed.data.reason,
            },
          },
        ).exec();

        if (!wasAnswered && status === "missed") {
          emitToUser(io, String(existing.calleeId), "call:missed", {
            ok: true,
            callId: parsed.data.callId,
            from: String(existing.callerId),
            at: now.toISOString(),
          });
        }
      }

      const ok = emitToUser(io, parsed.data.to, "call:end", {
        from: userId,
        ...parsed.data,
      });
      ack?.({ ok });
    },
  );

  socket.on(
    "chat:message",
    async (
      data: unknown,
      ack?: (res: { ok: boolean; chatId?: string; messageId?: string }) => void,
    ) => {
      const parsed = ChatMessageSchema.safeParse(data);
      if (!parsed.success) return ack?.({ ok: false });
      if (await isBlockedEitherWay(userId, parsed.data.to)) return ack?.({ ok: false });

      const me = await UserModel.findById(userId).select("friends").lean();
      if (!me) return ack?.({ ok: false });
      const isFriend = me.friends.some((id) => String(id) === parsed.data.to);
      if (!isFriend) return ack?.({ ok: false });

      const chat = await getOrCreateDmChat(userId, parsed.data.to);
      const now = new Date();

      let messageDoc: any = null;
      try {
        messageDoc = await MessageModel.create({
          chatId: chat._id,
          from: userId,
          type: "text",
          text: parsed.data.text,
          clientMessageId: parsed.data.clientMessageId,
          receipts: [],
        });
      } catch (e: any) {
        if (e?.code === 11000 && parsed.data.clientMessageId) {
          messageDoc = await MessageModel.findOne({
            from: userId,
            clientMessageId: parsed.data.clientMessageId,
          });
        }
        if (!messageDoc) return ack?.({ ok: false });
      }

      await ChatModel.updateOne(
        { _id: chat._id },
        { $set: { updatedAt: now } },
      ).exec();

      const payload = {
        ok: true,
        chatId: String(chat._id),
        message: {
          id: String(messageDoc._id),
          chatId: String(chat._id),
          from: userId,
          type: "text" as const,
          clientMessageId: messageDoc.clientMessageId ?? null,
          text: messageDoc.text ?? null,
          item: null,
          receipts: messageDoc.receipts ?? [],
          reactions: messageDoc.reactions ?? [],
          editedAt: messageDoc.editedAt ?? null,
          deletedAt: messageDoc.deletedAt ?? null,
          createdAt: messageDoc.createdAt,
        },
      };

      emitToUser(io, parsed.data.to, "chat:message", payload);
      emitToUser(io, userId, "chat:message", payload);

      ack?.({
        ok: true,
        chatId: String(chat._id),
        messageId: String(messageDoc._id),
      });
    },
  );

  socket.on(
    "share:item",
    async (
      data: unknown,
      ack?: (res: { ok: boolean; chatId?: string; messageId?: string }) => void,
    ) => {
      const parsed = ShareSchema.safeParse(data);
      if (!parsed.success) return ack?.({ ok: false });
      if (await isBlockedEitherWay(userId, parsed.data.to)) return ack?.({ ok: false });

      const me = await UserModel.findById(userId).select("friends").lean();
      if (!me) return ack?.({ ok: false });
      const isFriend = me.friends.some((id) => String(id) === parsed.data.to);
      if (!isFriend) return ack?.({ ok: false });

      const chat = await getOrCreateDmChat(userId, parsed.data.to);
      const now = new Date();

      let messageDoc: any = null;
      try {
        messageDoc = await MessageModel.create({
          chatId: chat._id,
          from: userId,
          type: "share",
          item: parsed.data.item,
          clientMessageId: parsed.data.clientMessageId,
          receipts: [],
        });
      } catch (e: any) {
        if (e?.code === 11000 && parsed.data.clientMessageId) {
          messageDoc = await MessageModel.findOne({
            from: userId,
            clientMessageId: parsed.data.clientMessageId,
          });
        }
        if (!messageDoc) return ack?.({ ok: false });
      }

      await ChatModel.updateOne(
        { _id: chat._id },
        { $set: { updatedAt: now } },
      ).exec();

      const payload = {
        ok: true,
        chatId: String(chat._id),
        message: {
          id: String(messageDoc._id),
          chatId: String(chat._id),
          from: userId,
          type: "share" as const,
          clientMessageId: messageDoc.clientMessageId ?? null,
          text: null,
          item: messageDoc.item,
          receipts: messageDoc.receipts ?? [],
          reactions: messageDoc.reactions ?? [],
          editedAt: messageDoc.editedAt ?? null,
          deletedAt: messageDoc.deletedAt ?? null,
          createdAt: messageDoc.createdAt,
        },
      };

      emitToUser(io, parsed.data.to, "share:item", payload);
      emitToUser(io, userId, "share:item", payload);

      ack?.({
        ok: true,
        chatId: String(chat._id),
        messageId: String(messageDoc._id),
      });
    },
  );
}
