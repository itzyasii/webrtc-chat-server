# Backend (TypeScript)

Express + Socket.IO signaling server for 1:1 WebRTC (audio/video) + real-time messaging and sharing.

## Run

1. `npm install`
2. `cp .env.example .env` (optional)
3. Start MongoDB locally (default `MONGODB_URI` is `mongodb://127.0.0.1:27017/webrtc_project`)
4. `npm run dev`

Health check: `GET /api/health`

## Uploads

- `POST /api/uploads` with form-data key `file`
- Uploaded files are served at `GET /uploads/<filename>`

## Socket.IO (signaling)

Client can connect with `auth: { accessToken: "<jwt>" }` (recommended) or `auth: { userId: "<your-id>" }` (or `?userId=<your-id>`).

Relayed events (server just forwards to the `to` user):

- `call:offer` `{ to, callId?, offer }`
- `call:answer` `{ to, callId, answer }`
- `call:ice-candidate` `{ to, callId, candidate }`
- `call:end` `{ to, callId, reason? }`
- `chat:message` `{ to, text, conversationId?, messageId? }`
- `share:item` `{ to, item, conversationId? }` where `item.kind` is `file|image|video|audio`

Presence events:

- `presence:me` (server -> client)
- `presence:online` (server -> client)
- `presence:update` (server -> all other clients)

## REST API (auth/users/chats)

Auth:

- `POST /api/auth/signup` `{ email, username, password }` -> `{ accessToken, user }` + sets refresh cookie
- `POST /api/auth/login` `{ emailOrUsername, password }` -> `{ accessToken, user }` + sets refresh cookie
- `POST /api/auth/refresh` -> `{ accessToken }` (reads refresh cookie or `{ refreshToken }`)
- `POST /api/auth/logout` -> clears refresh cookie
- `GET /api/auth/me` (Bearer access token)

Users / friends:

- `GET /api/users/search?q=...` (Bearer)
- `POST /api/users/friends/request` `{ toUserId }` (Bearer)
- `POST /api/users/friends/accept` `{ fromUserId }` (Bearer)
- `POST /api/users/friends/reject` `{ fromUserId }` (Bearer)
- `GET /api/users/friends` (Bearer)
- `GET /api/users/friends/requests` (Bearer)

Chats:

- `GET /api/chats` (Bearer)
- `POST /api/chats/dm` `{ userId }` (Bearer) -> creates/returns 1:1 chat
- `GET /api/chats/:chatId/messages?limit=50&before=...` (Bearer)
- `POST /api/chats/:chatId/messages` `{ type: "text", text }` or `{ type: "share", item }` (Bearer)
