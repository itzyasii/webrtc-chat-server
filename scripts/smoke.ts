import http from "node:http";
import { createApp } from "../src/app";
import { connectMongo, disconnectMongo } from "../src/db/mongo";
import { initSockets } from "../src/sockets";

async function listenEphemeral(server: http.Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind ephemeral port");
  return addr.port;
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
}

async function main() {
  await connectMongo();

  const app = createApp();
  const server = http.createServer(app);
  initSockets(server);
  const port = await listenEphemeral(server);
  const base = `http://127.0.0.1:${port}`;

  const rand = Math.floor(Math.random() * 1_000_000);
  const a = { email: `a_${rand}@example.com`, username: `a_${rand}`, password: "Password123!" };
  const b = { email: `b_${rand}@example.com`, username: `b_${rand}`, password: "Password123!" };

  const signupA = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(a),
  });
  if (!signupA.ok) throw new Error(`signupA failed: ${signupA.status}`);
  const signupAJson = await json<{ accessToken: string; user: { id: string } }>(signupA);

  const signupB = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  });
  if (!signupB.ok) throw new Error(`signupB failed: ${signupB.status}`);
  const signupBJson = await json<{ accessToken: string; user: { id: string } }>(signupB);

  const tokenA = signupAJson.accessToken;
  const tokenB = signupBJson.accessToken;
  const userA = signupAJson.user.id;
  const userB = signupBJson.user.id;

  const reqFriend = await fetch(`${base}/api/users/friends/request`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ toUserId: userB }),
  });
  if (!reqFriend.ok) throw new Error(`friend request failed: ${reqFriend.status}`);

  const acceptFriend = await fetch(`${base}/api/users/friends/accept`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ fromUserId: userA }),
  });
  if (!acceptFriend.ok) throw new Error(`friend accept failed: ${acceptFriend.status}`);

  const createDm = await fetch(`${base}/api/chats/dm`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ userId: userB }),
  });
  if (!createDm.ok) throw new Error(`create dm failed: ${createDm.status}`);
  const dmJson = await json<{ chat: { id: string } }>(createDm);

  const sendMsg = await fetch(`${base}/api/chats/${dmJson.chat.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ type: "text", text: "smoke hello" }),
  });
  if (!sendMsg.ok) throw new Error(`send message failed: ${sendMsg.status}`);

  const health = await fetch(`${base}/api/health`);
  if (!health.ok) throw new Error(`health failed: ${health.status}`);

  console.log("SMOKE_OK", { base, userA, userB, chatId: dmJson.chat.id });

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectMongo();
}

main().catch((err) => {
  console.error("SMOKE_FAIL", err);
  process.exit(1);
});

