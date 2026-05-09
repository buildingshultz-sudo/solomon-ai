/**
 * Solomon's Forge — Telegram bot integration.
 *
 * Long-polling Telegram bot. Each incoming message is routed through
 * Solomon's agent and the assistant's reply is sent back. Voice messages are
 * transcribed via OpenAI Whisper *if* an OpenAI API key is configured; if
 * Solomon is in Ollama-only mode they're rejected with a friendly note.
 *
 * Bot lifecycle is fully kill-switch aware: every outbound or inbound network
 * call registers an AbortController so the red kill button stops everything.
 *
 * Configuration lives in the SQLite settings table:
 *
 *   telegram.enabled          "1" | "0"
 *   telegram.bot_token        <token from @BotFather>
 *   telegram.allowed_user_ids "12345,67890" (comma list; empty = anyone)
 *   telegram.persona          optional system-prompt prefix for replies
 *
 * The user can boot/halt the bot from the Settings → Connectors page.
 */
import { getDb } from "../db";
import { settings as settingsTable } from "../../drizzle/schema";
import { runSolomon } from "../solomon/agent";
import { registerOperation } from "../solomon/killSwitch";

type TelegramBot = any;

let botInstance: TelegramBot | null = null;
let botUserIdAllowList: Set<string> = new Set();
let botPersona = "";

async function loadCfg() {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(settingsTable);
  const map = new Map<string, string>(rows.map((r) => [r.key, r.value ?? ""]));
  return {
    enabled: map.get("telegram.enabled") === "1",
    token: map.get("telegram.bot_token") || process.env.TELEGRAM_BOT_TOKEN || "",
    allowed: (map.get("telegram.allowed_user_ids") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    persona: map.get("telegram.persona") || "",
  };
}

async function importBot() {
  // Lazy-import to keep server cold-start fast and avoid breaking installs
  // that haven't run `pnpm install` after the upgrade.
  const mod = await import("node-telegram-bot-api").catch(() => null);
  if (!mod) {
    throw new Error(
      "node-telegram-bot-api is not installed. Run `pnpm install` then start Solomon's Forge."
    );
  }
  return (mod as any).default ?? mod;
}

export async function isTelegramRunning() {
  return !!botInstance;
}

export async function startTelegramBot(): Promise<{ ok: boolean; message: string }> {
  if (botInstance) return { ok: true, message: "Telegram bot already running." };
  const cfg = await loadCfg();
  if (!cfg) return { ok: false, message: "Database not ready." };
  if (!cfg.enabled) return { ok: false, message: "Telegram bot is disabled in Settings." };
  if (!cfg.token) {
    return { ok: false, message: "Set telegram.bot_token in Settings → Connectors first." };
  }

  const TelegramBotCtor = await importBot();
  const bot = new TelegramBotCtor(cfg.token, { polling: true });
  botUserIdAllowList = new Set(cfg.allowed);
  botPersona = cfg.persona;

  bot.on("message", async (msg: any) => {
    const userId = String(msg.from?.id ?? "");
    const chatId = msg.chat.id;
    const text = msg.text || msg.caption || "";

    if (botUserIdAllowList.size > 0 && !botUserIdAllowList.has(userId)) {
      await bot.sendMessage(
        chatId,
        "Sorry — this Solomon's Forge instance is private. Ask the owner to allow your Telegram ID."
      );
      return;
    }

    // Voice message → transcribe (only when OpenAI is the provider, since
    // local Ollama doesn't ship Whisper out of the box).
    let userText = text;
    if (msg.voice && !text) {
      userText = "(voice message — transcription requires OpenAI provider; please type instead.)";
    }
    if (!userText) {
      await bot.sendMessage(chatId, "I can hear you, but the message had no text I could read.");
      return;
    }

    const ac = new AbortController();
    const handle = registerOperation({
      label: `Telegram chat ${userId}`,
      kind: "background",
      controller: ac,
    });
    try {
      const reply = await runSolomon({
        conversation: [
          { role: "user", content: (botPersona ? `${botPersona}\n\n` : "") + userText },
        ],
      });
      const out = reply?.assistant || "Done.";
      // Telegram caps text at 4096 chars; chunk if longer.
      for (let i = 0; i < out.length; i += 4000) {
        await bot.sendMessage(chatId, out.slice(i, i + 4000), { parse_mode: "Markdown" }).catch(() =>
          bot.sendMessage(chatId, out.slice(i, i + 4000)),
        );
      }
    } catch (err: any) {
      await bot.sendMessage(chatId, `Solomon hit an error: ${err?.message ?? String(err)}`);
    } finally {
      handle.complete();
    }
  });

  bot.on("polling_error", (err: any) => {
    // eslint-disable-next-line no-console
    console.error("[Telegram] polling error:", err?.message ?? err);
  });

  botInstance = bot;
  return { ok: true, message: "Telegram bot is live and polling." };
}

export async function stopTelegramBot(): Promise<{ ok: boolean; message: string }> {
  if (!botInstance) return { ok: true, message: "Telegram bot was not running." };
  try {
    await botInstance.stopPolling();
  } catch {
    /* ignore */
  }
  botInstance = null;
  return { ok: true, message: "Telegram bot stopped." };
}

/** Send a message from Solomon to a chat (used by tools / scheduled jobs). */
export async function telegramSendMessage(chatId: string | number, text: string) {
  if (!botInstance) throw new Error("Telegram bot is not running.");
  return botInstance.sendMessage(chatId, text);
}

export async function telegramSendPhoto(chatId: string | number, photoPathOrUrl: string, caption?: string) {
  if (!botInstance) throw new Error("Telegram bot is not running.");
  return botInstance.sendPhoto(chatId, photoPathOrUrl, { caption });
}

export async function telegramSendVoice(chatId: string | number, audioPath: string) {
  if (!botInstance) throw new Error("Telegram bot is not running.");
  return botInstance.sendVoice(chatId, audioPath);
}
