import { Api, TelegramClient, errors } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import TelegramBot from "node-telegram-bot-api";

interface BotConfig {
  apiId: string;
  apiHash: string;
  phone: string;
  telegramBotToken: string;
  telegramChatId: string;
  usernames: string;
  delay: string;
  stringSession: string;
  useProxy: boolean;
  proxyType: string;
  proxyHost: string;
  proxyPort: string;
}

export class SniperBot {
  private client: TelegramClient | null = null;
  private running: boolean = false;
  private stats = { checks: 0, claims: 0, uptime: 0, lastCheck: 'Nigdy' };
  private logs: string[] = [];
  private startTime: number = 0;

  constructor(private config: BotConfig, private onLog: (log: string) => void) {}

  async start() {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();
    this.stats.uptime = 0;

    const apiId = parseInt(this.config.apiId);
    const apiHash = this.config.apiHash;
    const stringSession = new StringSession(this.config.stringSession || "");

    this.log(`[SYSTEM] Łączenie z serwerami Telegram (Timeout: 60s)...`);
    try {
      const clientOptions: any = {
        connectionRetries: 15,
        requestRetries: 10,
        timeout: 60000,
        useIPV6: false,
        deviceModel: "SniperBot Server",
        systemVersion: "1.0.0",
        appVersion: "1.0.0",
      };

      if (this.config.useProxy && this.config.proxyHost && this.config.proxyPort) {
        this.log(`[SYSTEM] Używanie proxy: ${this.config.proxyHost}:${this.config.proxyPort} (${this.config.proxyType})`);
        clientOptions.proxy = {
          ip: this.config.proxyHost,
          port: parseInt(this.config.proxyPort),
          socksType: this.config.proxyType === 'socks5' ? 5 : 4,
          timeout: 15,
        };
      }

      this.client = new TelegramClient(stringSession, apiId, apiHash, clientOptions);

      await this.client.connect();
      this.log(`[SYSTEM] Połączono z Telegramem.`);

      const authorized = await this.client.isUserAuthorized();
      if (!authorized) {
        this.log(`[ERROR] Klient nie jest autoryzowany. Wygeneruj nowy StringSession w zakładce Konfigurator.`);
        this.stop();
        return;
      }

      const me = await this.client.getMe();
      this.log(`[SYSTEM] Zalogowano jako: ${me.firstName} (@${me.username || 'brak'})`);
      
      const targetUsernames = this.config.usernames
        .split(',')
        .map(u => u.trim().replace('@', ''))
        .filter(u => u.length > 0);

      this.log(`[SYSTEM] Rozpoczęto monitorowanie: ${targetUsernames.join(', ')}`);

      this.monitorLoop(targetUsernames);
    } catch (error: any) {
      this.log(`[ERROR] Błąd startu: ${error.message}`);
      this.stop();
    }
  }

  private async monitorLoop(usernames: string[]) {
    const delay = parseFloat(this.config.delay) * 1000;
    
    while (this.running && this.client) {
      for (const username of usernames) {
        if (!this.running) break;
        
        try {
          this.stats.checks++;
          this.stats.lastCheck = new Date().toLocaleTimeString();
          
          // Check availability
          try {
            await this.client.invoke(new Api.contacts.ResolveUsername({ username }));
            // If it resolves, it's taken
          } catch (error: any) {
            if (error instanceof errors.FloodWaitError) {
              const waitTime = error.seconds;
              this.log(`[WARNING] FloodWait: Muszę poczekać ${waitTime}s przed kolejnym sprawdzeniem.`);
              await new Promise(r => setTimeout(r, waitTime * 1000));
            } else if (error.errorMessage === 'USERNAME_NOT_OCCUPIED') {
              this.log(`[BOT] 🚀 Username @${username} jest WOLNY! Próba przejęcia...`);
              
              try {
                this.log(`[BOT] 🛠 Tworzenie kanału publicznego dla @${username}...`);
                
                // 1. Create a channel
                const result = await this.client.invoke(new Api.channels.CreateChannel({
                  title: `Reserved @${username}`,
                  about: `Sniped by SniperBot`,
                  broadcast: true
                }));
                
                if (result instanceof Api.Updates) {
                  // Find the channel in the updates
                  const channel = result.chats.find(c => c instanceof Api.Channel) as Api.Channel;
                  
                  if (!channel) {
                    throw new Error("Nie znaleziono kanału w odpowiedzi serwera.");
                  }

                  this.log(`[BOT] 🔗 Ustawianie nazwy użytkownika @${username}...`);
                  
                  // 2. Set the username (this makes it public)
                  await this.client.invoke(new Api.channels.UpdateUsername({
                    channel: channel,
                    username: username
                  }));
                  
                  this.log(`[BOT] ✅ SUKCES! Przejęto @${username}.`);
                  this.stats.claims++;
                  
                  // Send notification
                  await this.sendNotification(`🚀 **SUKCES!**\nPrzejęto username: @${username}\nCzas: ${new Date().toLocaleString()}`);
                  
                  // Remove from list
                  usernames = usernames.filter(u => u !== username);
                }
              } catch (claimError: any) {
                if (claimError.errorMessage === 'CHANNELS_ADMIN_PUBLIC_TOO_MUCH') {
                  this.log(`[ERROR] Limit kanałów publicznych osiągnięty! Usuń niepotrzebne kanały publiczne.`);
                } else {
                  this.log(`[ERROR] Nie udało się przejąć @${username}: ${claimError.message}`);
                }
              }
            }
          }
          
          await new Promise(r => setTimeout(r, 100)); // Small delay between targets
        } catch (error: any) {
          if (error.message.includes('TIMEOUT')) {
            this.log(`[ERROR] Przekroczono czas połączenia (TIMEOUT) dla @${username}. Telegram nie odpowiada.`);
          } else {
            this.log(`[ERROR] Błąd podczas sprawdzania @${username}: ${error.message}`);
          }
        }
      }
      
      this.stats.uptime = Math.floor((Date.now() - this.startTime) / 1000);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  private async sendNotification(message: string) {
    if (this.config.telegramBotToken && this.config.telegramChatId) {
      try {
        const bot = new TelegramBot(this.config.telegramBotToken, { polling: false });
        await bot.sendMessage(this.config.telegramChatId, message, { parse_mode: 'Markdown' });
        this.log(`[SYSTEM] Powiadomienie wysłane na Telegram.`);
      } catch (error: any) {
        this.log(`[ERROR] Błąd wysyłania powiadomienia: ${error.message}`);
      }
    }
  }

  stop() {
    this.running = false;
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.log(`[SYSTEM] Bot zatrzymany.`);
  }

  private log(msg: string) {
    this.logs.push(msg);
    this.onLog(msg);
  }

  getStatus() {
    return {
      isBotRunning: this.running,
      botStats: this.stats,
      botLogs: this.logs
    };
  }
}
