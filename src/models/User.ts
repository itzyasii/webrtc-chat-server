import mongoose, { Schema } from "mongoose";

export type OAuthProvider = "google";

export interface UserDoc extends mongoose.Document {
  email: string;
  username: string;
  passwordHash?: string;
  friends: mongoose.Types.ObjectId[];
  incomingFriendRequests: mongoose.Types.ObjectId[];
  outgoingFriendRequests: mongoose.Types.ObjectId[];
  lastSeenAt?: Date;
  oauth?: {
    provider: OAuthProvider;
    providerUserId: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<UserDoc>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    passwordHash: { type: String },
    friends: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }],
    incomingFriendRequests: [
      { type: Schema.Types.ObjectId, ref: "User", default: [] },
    ],
    outgoingFriendRequests: [
      { type: Schema.Types.ObjectId, ref: "User", default: [] },
    ],
    lastSeenAt: { type: Date, default: () => new Date(), index: true },
    oauth: {
      provider: { type: String, enum: ["google"], required: false },
      providerUserId: { type: String, required: false },
    },
  },
  { timestamps: true },
);

UserSchema.index(
  { "oauth.provider": 1, "oauth.providerUserId": 1 },
  { unique: true, sparse: true },
);

export const UserModel = mongoose.model<UserDoc>("User", UserSchema);
