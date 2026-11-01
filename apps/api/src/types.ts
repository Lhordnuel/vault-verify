import type { Context, MiddlewareHandler } from 'hono';

export interface Bindings {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  GRADE_QUEUE: Queue<{ assessmentId: string }>;
  AI: Ai;
  GH_CLIENT_ID: string;
  GH_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  META_LLAMA_API_KEY?: string;
  AI_GATEWAY_BASE_URL?: string;
  AI_GATEWAY_TOKEN?: string;
  APP_ORIGIN?: string;
}

export interface AuthUser {
  id: string;
  github_username: string;
  handle: string;
}

export type AppContext = Context<{ Bindings: Bindings; Variables: { user: AuthUser } }>;
export type AuthMiddleware = MiddlewareHandler<{
  Bindings: Bindings;
  Variables: { user: AuthUser };
}>;
