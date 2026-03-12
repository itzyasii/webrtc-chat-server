import type { Server, Socket } from "socket.io";
import { z } from "zod";
import { emitToUser, listOnlineUsers } from "./store";

const UserId = z.string().min(1);

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
  to: UserId,
  callId: z.string().min(1).optional(),
  offer: RtcSessionDescription,
});

const CallAnswerSchema = z.object({
  to: UserId,
  callId: z.string().min(1),
  answer: RtcSessionDescription,
});

const CallIceSchema = z.object({
  to: UserId,
  callId: z.string().min(1),
  candidate: IceCandidate,
});

const CallEndSchema = z.object({
  to: UserId,
  callId: z.string().min(1),
  reason: z.string().optional(),
});

const ChatMessageSchema = z.object({
  to: UserId,
  conversationId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  text: z.string().min(1).max(4000),
});

const ShareItemSchema = z.object({
  kind: z.enum(["file", "image", "video", "audio"]),
  url: z.string().min(1),
  originalName: z.string().min(1).optional(),
  mime: z.string().min(1).optional(),
  size: z.number().int().nonnegative().optional(),
});

const ShareSchema = z.object({
  to: UserId,
  conversationId: z.string().min(1).optional(),
  item: ShareItemSchema,
});

export function registerSignalingHandlers(io: Server, socket: Socket, userId: string) {
  socket.on("presence:list", (ack?: (res: { ok: true; users: string[] }) => void) => {
    if (ack) ack({ ok: true, users: listOnlineUsers() });
  });

  socket.on("call:offer", (data: unknown, ack?: (res: { ok: boolean }) => void) => {
    const parsed = CallOfferSchema.safeParse(data);
    if (!parsed.success) return ack?.({ ok: false });
    const ok = emitToUser(io, parsed.data.to, "call:offer", { from: userId, ...parsed.data });
    ack?.({ ok });
  });

  socket.on("call:answer", (data: unknown, ack?: (res: { ok: boolean }) => void) => {
    const parsed = CallAnswerSchema.safeParse(data);
    if (!parsed.success) return ack?.({ ok: false });
    const ok = emitToUser(io, parsed.data.to, "call:answer", { from: userId, ...parsed.data });
    ack?.({ ok });
  });

  socket.on("call:ice-candidate", (data: unknown, ack?: (res: { ok: boolean }) => void) => {
    const parsed = CallIceSchema.safeParse(data);
    if (!parsed.success) return ack?.({ ok: false });
    const ok = emitToUser(io, parsed.data.to, "call:ice-candidate", { from: userId, ...parsed.data });
    ack?.({ ok });
  });

  socket.on("call:end", (data: unknown, ack?: (res: { ok: boolean }) => void) => {
    const parsed = CallEndSchema.safeParse(data);
    if (!parsed.success) return ack?.({ ok: false });
    const ok = emitToUser(io, parsed.data.to, "call:end", { from: userId, ...parsed.data });
    ack?.({ ok });
  });

  socket.on("chat:message", (data: unknown, ack?: (res: { ok: boolean }) => void) => {
    const parsed = ChatMessageSchema.safeParse(data);
    if (!parsed.success) return ack?.({ ok: false });
    const ok = emitToUser(io, parsed.data.to, "chat:message", { from: userId, ...parsed.data });
    ack?.({ ok });
  });

  socket.on("share:item", (data: unknown, ack?: (res: { ok: boolean }) => void) => {
    const parsed = ShareSchema.safeParse(data);
    if (!parsed.success) return ack?.({ ok: false });
    const ok = emitToUser(io, parsed.data.to, "share:item", { from: userId, ...parsed.data });
    ack?.({ ok });
  });
}
