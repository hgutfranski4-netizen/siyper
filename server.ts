import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, ChildProcess } from "child_process";
import { SniperBot } from "./bot";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize DB
  const db = await open({
    filename: './database.db',
    driver: sqlite3.Database
  });
  await db.exec('CREATE TABLE IF NOT EXISTS seen_usernames (username TEXT PRIMARY KEY)');
  await db.exec('CREATE TABLE IF NOT EXISTS bot_config (id INTEGER PRIMARY KEY, key TEXT UNIQUE, value TEXT)');

  // API Route: Get Config
  app.get("/api/config", async (req, res) => {
    const rows = await db.all('SELECT key, value FROM bot_config');
    const config = rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
    res.json(config);
  });

  // API Route: Save Config
  app.post("/api/config", express.json(), async (req, res) => {
    const config = req.body;
    for (const [key, value] of Object.entries(config)) {
      await db.run('INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)', [key, String(value)]);
    }
    res.json({ status: 'success' });
  });

  // Telegram Bot
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  let bot: TelegramBot | null = null;
  if (botToken) {
    bot = new TelegramBot(botToken, { polling: false });
  }

  // Bot State
  let isBotRunning = false;
  let botMode: 'capture' | 'simulation' = 'capture';
  let botLogs: string[] = ['[SYSTEM] Bot gotowy do uruchomienia.'];
  let botStats = { checks: 0, claims: 0, uptime: 0, lastCheck: 'Nigdy' };
  let sniperBot: SniperBot | null = null;

  // Telegram Auth Sessions
  const authSessions = new Map<string, { client: TelegramClient, phoneCodeHash: string }>();

  // API Route: Send Auth Code
  app.post("/api/auth/send-code", express.json(), async (req, res) => {
    const { phone, apiId, apiHash } = req.body;
    try {
      const client = new TelegramClient(new StringSession(""), parseInt(apiId), apiHash, { connectionRetries: 5 });
      await client.connect();
      const result: any = await client.invoke(new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: parseInt(apiId),
        apiHash: apiHash,
        settings: new Api.CodeSettings({
          allowFlashcall: true,
          currentNumber: true,
          allowAppHash: true,
        }),
      }));
      const phoneCodeHash = result.phoneCodeHash;
      authSessions.set(phone, { client, phoneCodeHash });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: Sign In
  app.post("/api/auth/sign-in", express.json(), async (req, res) => {
    const { phone, code, password, apiId, apiHash } = req.body;
    const sessionData = authSessions.get(phone);
    if (!sessionData) return res.status(400).json({ error: "Sesja nie znaleziona. Wyślij kod ponownie." });
    
    const { client, phoneCodeHash } = sessionData;
    try {
      try {
        await client.invoke(new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash: phoneCodeHash,
          phoneCode: code
        }));
      } catch (error: any) {
        if (error.errorMessage === 'SESSION_PASSWORD_NEEDED') {
          if (!password) {
            return res.json({ requiresPassword: true });
          }
          // If password provided, use client.signIn helper which handles SRP
          // We cast to any to bypass the linter error if it persists
          await (client as any).signIn({
            phoneNumber: phone,
            password: async () => password,
            phoneCodeHash: phoneCodeHash,
            phoneCode: async () => code,
            onError: (err: any) => { throw err; }
          });
        } else {
          throw error;
        }
      }
      const stringSession = client.session.save() as unknown as string;
      authSessions.delete(phone);
      res.json({ stringSession });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: Get Bot Status
  app.get("/api/status", (req, res) => {
    if (sniperBot) {
      const status = sniperBot.getStatus();
      res.json({ 
        isBotRunning: status.isBotRunning, 
        botMode, 
        botLogs: botLogs, 
        botStats: status.botStats 
      });
    } else {
      res.json({ isBotRunning, botMode, botLogs, botStats });
    }
  });

  // API Route: Start/Stop Bot
  app.post("/api/bot/:action", express.json(), async (req, res) => {
    const { action } = req.params;
    const { mode, config } = req.body;
    
    if (action === 'start') {
      if (isBotRunning) return res.json({ isBotRunning, botMode });
      
      isBotRunning = true;
      botMode = mode || 'capture';
      botLogs.push(`[SYSTEM] Bot uruchomiony w trybie: ${botMode}.`);
      
      // Save config to DB
      for (const [key, value] of Object.entries(config)) {
        await db.run('INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)', [key, String(value)]);
      }

      // Initialize and start Node.js bot
      sniperBot = new SniperBot(config, (log) => {
        botLogs.push(log);
        if (botLogs.length > 100) botLogs.shift();
      });
      
      await sniperBot.start();
      
    } else if (action === 'stop') {
      if (sniperBot) {
        sniperBot.stop();
        sniperBot = null;
      }
      isBotRunning = false;
      botLogs.push('[SYSTEM] Bot zatrzymany.');
    }
    res.json({ isBotRunning, botMode });
  });

  // API Route: Monitor Fragment (updated to use state)
  app.get("/api/monitor", async (req, res) => {
    // ... existing logic ...
    res.json({ status: "checked" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production static file serving
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
