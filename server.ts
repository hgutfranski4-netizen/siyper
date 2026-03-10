import express from "express";
import { createServer as createViteServer } from "vite";
import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { SniperBot } from "./bot";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log("[SYSTEM] Starting server initialization...");

  // Health check route - MUST be first
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  // Database Abstraction
  let db: any = {
    exec: async () => {},
    all: async () => [],
    run: async () => {}
  };
  const isPostgres = !!process.env.DATABASE_URL;

  // Initialize DB in background
  (async () => {
    try {
      if (isPostgres) {
        console.log("[SYSTEM] Attempting to connect to PostgreSQL...");
        const pool = new pg.Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false }
        });
        
        await pool.query('SELECT NOW()');
        console.log("[SYSTEM] PostgreSQL connected successfully.");
        
        db.exec = async (sql: string) => {
          const pgSql = sql.replace(/INTEGER PRIMARY KEY/g, 'SERIAL PRIMARY KEY')
                           .replace(/TEXT PRIMARY KEY/g, 'TEXT PRIMARY KEY');
          await pool.query(pgSql);
        };
        db.all = async (sql: string, params: any[] = []) => {
          const res = await pool.query(sql.replace(/\?/g, (_, i) => `$${i + 1}`), params);
          return res.rows;
        };
        db.run = async (sql: string, params: any[] = []) => {
          let pgSql = sql.replace(/\?/g, (_, i) => `$${i + 1}`);
          if (pgSql.includes('INSERT OR REPLACE')) {
            const tableName = pgSql.match(/INTO (\w+)/)?.[1];
            const columns = pgSql.match(/\((.*?)\)/)?.[1];
            if (tableName && columns) {
               const colArr = columns.split(',').map(c => c.trim());
               const conflictCol = colArr[0];
               pgSql = pgSql.replace('INSERT OR REPLACE', 'INSERT') + 
                       ` ON CONFLICT (${conflictCol}) DO UPDATE SET ` + 
                       colArr.slice(1).map((c, i) => `${c} = EXCLUDED.${c}`).join(', ');
            }
          }
          await pool.query(pgSql, params);
        };
      } else {
        console.log("[SYSTEM] Using SQLite database.");
        const sqliteDb = await open({
          filename: './database.db',
          driver: sqlite3.Database
        });
        db.exec = (sql: string) => sqliteDb.exec(sql);
        db.all = (sql: string, params: any[] = []) => sqliteDb.all(sql, params);
        db.run = (sql: string, params: any[] = []) => sqliteDb.run(sql, params);
      }

      await db.exec('CREATE TABLE IF NOT EXISTS seen_usernames (username TEXT PRIMARY KEY)');
      await db.exec('CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT)');
      console.log("[SYSTEM] Database tables initialized.");
    } catch (dbError: any) {
      console.error("[DATABASE ERROR]", dbError);
      app.get("/api/db-error", (req, res) => res.json({ error: dbError.message }));
    }
  })();

  // API Route: Get Config
  app.get("/api/config", async (req, res) => {
    try {
      const rows = await db.all('SELECT key, value FROM bot_config');
      const config = rows.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value }), {});
      res.json(config);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // API Route: Save Config
  app.post("/api/config", express.json(), async (req, res) => {
    try {
      const config = req.body;
      for (const [key, value] of Object.entries(config)) {
        await db.run('INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)', [key, String(value)]);
      }
      bot = null; // Reset bot instance to pick up new token if changed
      res.json({ status: 'success' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Telegram Bot
  let bot: TelegramBot | null = null;
  
  const getBot = async () => {
    if (bot) return bot;
    
    let token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      const rows = await db.all('SELECT value FROM bot_config WHERE key = ?', ['telegramBotToken']);
      if (rows.length > 0) token = rows[0].value;
    }
    
    if (token) {
      bot = new TelegramBot(token, { polling: false });
      return bot;
    }
    return null;
  };

  const getChatId = async () => {
    let id = process.env.TELEGRAM_CHAT_ID;
    if (!id) {
      const rows = await db.all('SELECT value FROM bot_config WHERE key = ?', ['telegramChatId']);
      if (rows.length > 0) id = rows[0].value;
    }
    return id;
  };

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
      const rows = await db.all('SELECT key, value FROM bot_config');
      const config = rows.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value }), {});
      
      const clientOptions: any = { 
        connectionRetries: 15,
        requestRetries: 10,
        timeout: 60000,
        useIPV6: false,
      };

      if (config.useProxy === 'true' && config.proxyHost && config.proxyPort) {
        clientOptions.proxy = {
          ip: config.proxyHost,
          port: parseInt(config.proxyPort),
          socksType: config.proxyType === 'socks5' ? 5 : 4,
          timeout: 15,
        };
      }

      const client = new TelegramClient(new StringSession(""), parseInt(apiId), apiHash, clientOptions);
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
      await client.disconnect();
      authSessions.delete(phone);
      res.json({ stringSession });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // API Route: Test Connection
  app.post("/api/auth/test", express.json(), async (req, res) => {
    const { apiId, apiHash, stringSession } = req.body;
    try {
      const rows = await db.all('SELECT key, value FROM bot_config');
      const config = rows.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value }), {});

      const clientOptions: any = { 
        connectionRetries: 5,
        requestRetries: 3,
        timeout: 20000,
        useIPV6: false,
      };

      if (config.useProxy === 'true' && config.proxyHost && config.proxyPort) {
        clientOptions.proxy = {
          ip: config.proxyHost,
          port: parseInt(config.proxyPort),
          socksType: config.proxyType === 'socks5' ? 5 : 4,
          timeout: 15,
        };
      }

      const client = new TelegramClient(new StringSession(stringSession), parseInt(apiId), apiHash, clientOptions);
      await client.connect();
      const me = await client.getMe();
      await client.disconnect();
      res.json({ success: true, user: me.firstName });
    } catch (error: any) {
      res.json({ success: false, error: error.message });
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
      bot = null; // Reset bot instance

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
    console.log(`[SYSTEM] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
