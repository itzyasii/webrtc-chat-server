import { Router } from "express";
import { healthRouter } from "./health";
import { uploadsRouter } from "./uploads";
import { authRouter } from "./auth";
import { usersRouter } from "./users";
import { chatsRouter } from "./chats";

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(uploadsRouter);
apiRouter.use(authRouter);
apiRouter.use(usersRouter);
apiRouter.use(chatsRouter);
