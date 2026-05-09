import { eq } from "drizzle-orm";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: any | null = null;
let _localShim: any | null = null;

function isLocalMode(): boolean {
  return process.env.SOLOMON_LOCAL === "1" || process.env.SOLOMON_LOCAL === "true";
}

// Lazily create the drizzle instance (or local SQLite shim) so local tooling
// can run without a network DB.
export async function getDb() {
  if (_db) return _db;

  if (isLocalMode()) {
    // Desktop / Solomon's Forge mode — single-file SQLite.
    const { openLocalDb } = await import("./db.local");
    const { drizzleShim } = await openLocalDb();
    _localShim = drizzleShim;
    _db = drizzleShim;
    return _db;
  }

  if (process.env.DATABASE_URL) {
    try {
      // Lazy-load the mysql2 driver only when a DATABASE_URL is set. We hide
      // the specifier behind a dynamic string so the bundler does not try to
      // pre-resolve `drizzle-orm/mysql2` (and transitively `mysql2`) at build
      // time. In local (sql.js) mode this branch never executes.
      const mysqlSpec = ["drizzle-orm", "mysql2"].join("/");
      const mod: any = await import(/* @vite-ignore */ mysqlSpec);
      _db = mod.drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// TODO: add feature queries here as your schema grows.
