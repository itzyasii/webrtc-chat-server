import { getIo } from "./runtime";
import { emitToUser } from "./store";

export function broadcastToUsers(userIds: string[], event: string, payload: unknown) {
  const io = getIo();
  if (!io) return false;
  for (const id of userIds) emitToUser(io, id, event, payload);
  return true;
}

