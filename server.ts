import express from "express";
import { createServer as createViteServer } from "vite";
import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { SniperBot } from "./bot.ts";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

console.log(`[SYSTEM] Initializing server. NODE_ENV: ${process.env.NODE_ENV}, PORT: ${PORT}`);

// Start listening IMMEDIATELY at top level to satisfy Railway
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[SYSTEM] Server is now listening on http://0.0.0.0:${PORT}`);
});

async function startServer() {
  // Error handling for the whole process
  process.on('uncaughtException', (err) => {
    console.error('[FATAL ERROR] Uncaught Exception:', err);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
  });

  // Health check route - MUST be first
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime(), env: process.env.NODE_ENV });
  });

  // Simple root route for diagnostics
  app.get("/", (req, res, next) => {
    if (process.env.NODE_ENV === "production") {
      next(); // Fall through to static serving
    } else {
      res.send("SniperBot Server is running (Development Mode)");
    }
  });

  try {
    // Database Abstraction
    let db: any = {
      exec: async () => {},
      all: async () => [],
      run: async () => {}
    };
    const isPostgres = !!process.env.DATABASE_URL;

    // Initialize DB
    try {
      if (isPostgres) {
        console.log("[SYSTEM] Connecting to PostgreSQL...");
        const pool = new pg.Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false }
        });
        
        await pool.query('SELECT NOW()');
        console.log("[SYSTEM] PostgreSQL connected.");
        
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
        console.log("[SYSTEM] Using SQLite.");
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
      console.log("[SYSTEM] Database ready.");
    } catch (dbError: any) {
      console.error("[DATABASE ERROR]", dbError);
    }

    // API Routes
    app.get("/api/config", async (req, res) => {
      try {
        const rows = await db.all('SELECT key, value FROM bot_config');
        const config = rows.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value }), {});
        res.json(config);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    app.post("/api/config", express.json(), async (req, res) => {
      try {
        const config = req.body;
        for (const [key, value] of Object.entries(config)) {
          await db.run('INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)', [key, String(value)]);
        }
        bot = null;
        res.json({ status: 'success' });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // ... (rest of the API routes: auth, status, bot actions) ...
    // Note: I'm keeping the logic but ensuring they use the initialized 'db'
    
    let bot: TelegramBot | null = null;
    let isBotRunning = false;
    let botMode: 'capture' | 'simulation' = 'capture';
    let botLogs: string[] = ['[SYSTEM] Bot gotowy.'];
    let botStats = { checks: 0, claims: 0, uptime: 0, lastCheck: 'Nigdy' };
    let sniperBot: SniperBot | null = null;
    const authSessions = new Map<string, { client: TelegramClient, phoneCodeHash: string }>();

    app.post("/api/auth/send-code", express.json(), async (req, res) => {
      const { phone, apiId, apiHash } = req.body;
      console.log(`[AUTH] Sending code to ${phone}`);
      try {
        const rows = await db.all('SELECT key, value FROM bot_config');
        const config = rows.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value }), {});
        const clientOptions: any = { connectionRetries: 20, requestRetries: 10, timeout: 90000, useIPV6: false };
        if ((config.useProxy === 'true' || config.useProxy === true) && config.proxyHost && config.proxyPort) {
          clientOptions.proxy = { ip: config.proxyHost, port: parseInt(config.proxyPort), socksType: config.proxyType === 'socks5' ? 5 : 4, timeout: 15 };
        }
        const client = new TelegramClient(new StringSession(""), parseInt(apiId), apiHash, clientOptions);
        await client.connect();
        const result: any = await client.invoke(new Api.auth.SendCode({
          phoneNumber: phone, apiId: parseInt(apiId), apiHash: apiHash,
          settings: new Api.CodeSettings({ allowFlashcall: false, currentNumber: true, allowAppHash: true })
        }));
        authSessions.set(phone, { client, phoneCodeHash: result.phoneCodeHash });
        res.json({ success: true });
      } catch (error: any) {
        console.error(`[AUTH ERROR]`, error);
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/api/auth/sign-in", express.json(), async (req, res) => {
      const { phone, code, password } = req.body;
      const sessionData = authSessions.get(phone);
      if (!sessionData) return res.status(400).json({ error: "Sesja wygasła." });
      const { client, phoneCodeHash } = sessionData;
      try {
        try {
          await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
        } catch (error: any) {
          if (error?.errorMessage === 'SESSION_PASSWORD_NEEDED') {
            if (!password) return res.json({ requiresPassword: true });
            await (client as any).signIn({ phoneNumber: phone, password: async () => password, phoneCodeHash, phoneCode: async () => code });
          } else throw error;
        }
        const stringSession = client.session.save() as unknown as string;
        await client.disconnect();
        authSessions.delete(phone);
        res.json({ stringSession });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/api/status", (req, res) => {
      if (sniperBot) {
        const status = sniperBot.getStatus();
        res.json({ isBotRunning: status.isBotRunning, botMode, botLogs, botStats: status.botStats });
      } else {
        res.json({ isBotRunning, botMode, botLogs, botStats });
      }
    });

    app.post("/api/bot/:action", express.json(), async (req, res) => {
      const { action } = req.params;
      const { mode, config } = req.body;
      if (action === 'start') {
        if (isBotRunning) return res.json({ isBotRunning });
        isBotRunning = true;
        botMode = mode || 'capture';
        if (config) {
          for (const [key, value] of Object.entries(config)) {
            await db.run('INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)', [key, String(value)]);
          }
        }
        sniperBot = new SniperBot(config, (log) => {
          botLogs.push(log);
          if (botLogs.length > 100) botLogs.shift();
        });
        await sniperBot.start();
      } else if (action === 'stop') {
        if (sniperBot) { sniperBot.stop(); sniperBot = null; }
        isBotRunning = false;
      }
      res.json({ isBotRunning, botMode });
    });

    // Vite / Static Files
    if (process.env.NODE_ENV !== "production") {
      console.log("[SYSTEM] Starting Vite in middleware mode...");
      try {
        const vite = await createViteServer({
          server: { middlewareMode: true },
          appType: "spa",
        });
        app.use(vite.middlewares);
      } catch (viteError) {
        console.error("[VITE ERROR] Could not start Vite, falling back to static mode:", viteError);
      }
    }

    // Always serve static files if dist exists, as a fallback
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      const indexPath = path.resolve(distPath, "index.html");
      res.sendFile(indexPath, (err) => {
        if (err && !res.headersSent) {
          res.status(404).send("Frontend not built. Run 'npm run build' first.");
        }
      });
    });

  } catch (startError) {
    console.error("[SYSTEM ERROR] Failed to initialize server components:", startError);
  }
}

startServer();
