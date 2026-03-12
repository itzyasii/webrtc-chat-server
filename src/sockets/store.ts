import type { Server } from "socket.io";

const userToSocketIds = new Map<string, Set<string>>();
const socketIdToUser = new Map<string, string>();

export function addSocketForUser(userId: string, socketId: string) {
  socketIdToUser.set(socketId, userId);
  const set = userToSocketIds.get(userId) ?? new Set<string>();
  set.add(socketId);
  userToSocketIds.set(userId, set);
}

export function removeSocket(socketId: string) {
  const userId = socketIdToUser.get(socketId);
  socketIdToUser.delete(socketId);
  if (!userId) return;
  const set = userToSocketIds.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) userToSocketIds.delete(userId);
}

export function listOnlineUsers() {
  return Array.from(userToSocketIds.keys());
}

export function emitToUser(
  io: Server,
  userId: string,
  event: string,
  payload: unknown,
) {
  const socketIds = userToSocketIds.get(userId);
  if (!socketIds || socketIds.size === 0) return false;
  for (const id of socketIds) io.to(id).emit(event, payload);
  return true;
}
