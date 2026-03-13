import { UserModel } from "../models/User";

export type SerializedReactionUser = {
  id: string;
  username?: string;
  email?: string;
};

type ReactionLike = {
  emoji?: string;
  userId?: unknown;
  createdAt?: unknown;
} | null | undefined;

type MessageLike = {
  reactions?: ReactionLike[] | null;
};

export async function buildReactionUserMap(messages: MessageLike[]) {
  const ids = Array.from(
    new Set(
      messages.flatMap((message) =>
        (message.reactions ?? [])
          .map((reaction) => reaction?.userId)
          .filter(Boolean)
          .map((userId) => String(userId)),
      ),
    ),
  );

  if (ids.length === 0) return new Map<string, SerializedReactionUser>();

  const users = await UserModel.find({ _id: { $in: ids } })
    .select("_id username email")
    .lean();

  return new Map<string, SerializedReactionUser>(
    users.map((user) => [
      String(user._id),
      {
        id: String(user._id),
        username: user.username,
        email: user.email,
      },
    ]),
  );
}

export function serializeReactions(
  reactions: ReactionLike[] | null | undefined,
  userMap: Map<string, SerializedReactionUser>,
) {
  return (reactions ?? []).flatMap((reaction) => {
    if (!reaction?.emoji || !reaction.userId) return [];
    const userId = String(reaction.userId);
    const createdAt = reaction.createdAt instanceof Date
      ? reaction.createdAt.toISOString()
      : reaction.createdAt == null
        ? new Date().toISOString()
        : String(reaction.createdAt);
    return [{
      emoji: reaction.emoji,
      userId,
      createdAt,
      user: userMap.get(userId) ?? { id: userId },
    }];
  });
}
