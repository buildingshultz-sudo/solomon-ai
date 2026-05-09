import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

function isLocalMode() {
  return process.env.SOLOMON_LOCAL === "1" || process.env.SOLOMON_LOCAL === "true";
}

// Cached single owner user for desktop/local mode.
let _localOwner: User | null = null;

async function getLocalOwner(): Promise<User | null> {
  if (_localOwner) return _localOwner;
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return null;
    const { users } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(users).where(eq(users.openId, "local-owner")).limit(1);
    _localOwner = (rows && rows[0]) || null;
    return _localOwner;
  } catch {
    return null;
  }
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  if (isLocalMode()) {
    // Solomon's Forge desktop mode: there's exactly one user (the owner) and no
    // OAuth is involved. Always present them as authenticated.
    user = await getLocalOwner();
    return { req: opts.req, res: opts.res, user };
  }

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
