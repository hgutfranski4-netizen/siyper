import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, ChildProcess } from "child_process";

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
  let botProcess: ChildProcess | null = null;

  // API Route: Get Bot Status
  app.get("/api/status", (req, res) => {
    res.json({ isBotRunning, botMode, botLogs, botStats });
  });

  // API Route: Start/Stop Bot
  app.post("/api/bot/:action", express.json(), (req, res) => {
    const { action } = req.params;
    const { mode, config } = req.body;
    if (action === 'start') {
      if (isBotRunning) return res.json({ isBotRunning, botMode });
      
      isBotRunning = true;
      botMode = mode || 'capture';
      botLogs.push(`[SYSTEM] Bot uruchomiony w trybie: ${botMode}.`);
      
      // Prepare environment variables
      const env = {
        ...process.env,
        API_ID: config.apiId,
        API_HASH: config.apiHash,
        PHONE: config.phone,
        TELEGRAM_BOT_TOKEN: config.telegramBotToken,
        TELEGRAM_CHAT_ID: config.telegramChatId,
        TARGET_USERNAMES: config.usernames,
        CHECK_INTERVAL: config.delay,
        STRING_SESSION: config.stringSession,
      };
      if (config.useProxy && config.proxyHost && config.proxyPort) {
        env.PROXY = `${config.proxyType}://${config.proxyHost}:${config.proxyPort}`;
      }

      // Spawn Python bot process
      botProcess = spawn('python3', ['python_monitor/monitor.py'], { env });
      
      botProcess.stdout?.on('data', (data) => {
        botLogs.push(`[BOT] ${data.toString()}`);
      });
      
      botProcess.stderr?.on('data', (data) => {
        botLogs.push(`[ERROR] ${data.toString()}`);
      });
      
      botProcess.on('close', (code) => {
        isBotRunning = false;
        botLogs.push(`[SYSTEM] Bot zatrzymany z kodem: ${code}.`);
        botProcess = null;
      });
      
    } else if (action === 'stop') {
      if (botProcess) {
        botProcess.kill();
        botProcess = null;
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
