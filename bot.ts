import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";

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

    this.log(`[SYSTEM] Inicjalizacja bota Node.js...`);

    try {
      this.client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
      });

      await this.client.connect();

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
            if (error.errorMessage === 'USERNAME_NOT_OCCUPIED') {
              this.log(`[BOT] 🚀 Username @${username} jest WOLNY! Próba przejęcia...`);
              
              try {
                // Try to claim by creating a channel
                const result = await this.client.invoke(new Api.channels.CreateChannel({
                  title: `Reserved @${username}`,
                  about: `Sniped by SniperBot`,
                  broadcast: true
                }));
                
                if (result instanceof Api.Updates) {
                  const channel = result.chats[0] as Api.Channel;
                  await this.client.invoke(new Api.channels.UpdateUsername({
                    channel: channel,
                    username: username
                  }));
                  
                  this.log(`[BOT] ✅ SUKCES! Przejęto @${username} do nowego kanału.`);
                  this.stats.claims++;
                  
                  // Remove from list
                  usernames = usernames.filter(u => u !== username);
                }
              } catch (claimError: any) {
                this.log(`[ERROR] Nie udało się przejąć @${username}: ${claimError.message}`);
              }
            }
          }
          
          await new Promise(r => setTimeout(r, 100)); // Small delay between targets
        } catch (error: any) {
          this.log(`[ERROR] Błąd podczas sprawdzania @${username}: ${error.message}`);
        }
      }
      
      this.stats.uptime = Math.floor((Date.now() - this.startTime) / 1000);
      await new Promise(r => setTimeout(r, delay));
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
