import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { corsOriginList } from "../config/env";
import { logger } from "../config/logger";
import { verifyAccessToken } from "../auth/tokens";
import { registerSignalingHandlers } from "./signaling";
import { deliverPendingMessages, registerChatRealtimeHandlers } from "./chatRealtime";
import { addSocketForUser, listOnlineUsers, removeSocket } from "./store";
import { UserModel } from "../models/User";
import { setIo } from "./runtime";

const UserIdSchema = z.string().min(1);

export function initSockets(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors:
      corsOriginList === "*"
        ? { origin: true }
        : {
            origin: corsOriginList,
          },
  });

  setIo(io);

  io.use((socket, next) => {
    const token = socket.handshake.auth?.accessToken;
    if (typeof token === "string" && token.length > 0) {
      try {
        const payload = verifyAccessToken(token);
        socket.data.userId = payload.sub;
        return next();
      } catch {
        return next(new Error("invalid access token"));
      }
    }

    const userId =
      socket.handshake.auth?.userId ?? socket.handshake.query?.userId;
    const parsed = UserIdSchema.safeParse(userId);
    if (!parsed.success)
      return next(new Error("userId or accessToken required"));
    socket.data.userId = parsed.data;
    next();
  });

  io.on("connection", (socket) => {
    const userId = String(socket.data.userId);
    addSocketForUser(userId, socket.id);
    logger.info("socket connected", { userId, socketId: socket.id });

    void UserModel.updateOne(
      { _id: userId },
      { $set: { lastSeenAt: new Date() } },
    ).exec();

    socket.emit("presence:me", { ok: true, userId });
    socket.emit("presence:online", { ok: true, users: listOnlineUsers() });
    socket.broadcast.emit("presence:update", {
      ok: true,
      users: listOnlineUsers(),
    });

    void deliverPendingMessages(io, userId);

    registerSignalingHandlers(io, socket, userId);
    registerChatRealtimeHandlers(io, socket, userId);

    socket.on("disconnect", (reason) => {
      removeSocket(socket.id);
      logger.info("socket disconnected", {
        userId,
        socketId: socket.id,
        reason,
      });
      socket.broadcast.emit("presence:update", {
        ok: true,
        users: listOnlineUsers(),
      });
      void UserModel.updateOne(
        { _id: userId },
        { $set: { lastSeenAt: new Date() } },
      ).exec();
    });
  });

  return io;
}
