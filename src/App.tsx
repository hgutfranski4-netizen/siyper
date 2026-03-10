import React, { useState, useEffect } from 'react';
import { Terminal, Settings, FileCode2, BookOpen, Copy, Check, Download, ShieldAlert, ChevronRight, FileText, Activity, Play, Square, RefreshCw, Zap, Clock, Shield, Menu, X } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";

const SNIPER_PY = `import asyncio
import logging
from telethon import TelegramClient, errors
from telethon.sessions import StringSession
from telethon.tl.functions.account import UpdateUsernameRequest
from telethon.tl.functions.contacts import ResolveUsernameRequest
from datetime import datetime
import random

logger = logging.getLogger(__name__)

class UsernameSniper:
    def __init__(self, client: TelegramClient, target_usernames: list, check_interval: float = 0.5):
        self.client = client
        self.target_usernames = target_usernames
        self.check_interval = check_interval
        self.running = False
        self.stats = {
            'checks': 0,
            'found_free': 0,
            'sniped': 0,
            'errors': 0
        }
        
    async def check_username(self, username: str) -> bool:
        """
        Sprawdza, czy username jest dostępny.
        Zwraca True jeśli wolny, False jeśli zajęty.
        """
        try:
            # Próba resolvu username - jeśli się uda, znaczy że zajęty
            await self.client(ResolveUsernameRequest(username))
            return False  # Username zajęty
        except errors.UsernameNotOccupiedError:
            # To jest to! Username wolny!
            self.stats['found_free'] += 1
            return True
        except errors.UsernameInvalidError:
            logger.warning(f"Username {username} jest nieprawidłowy")
            return False
        except Exception as e:
            logger.error(f"Błąd podczas sprawdzania {username}: {e}")
            self.stats['errors'] += 1
            return False
            
    async def snipe_username(self, username: str) -> bool:
        """
        Próbuje przechwycić username na bieżące konto.
        Zwraca True jeśli sukces.
        """
        try:
            result = await self.client(UpdateUsernameRequest(username))
            if getattr(result, 'username', None) == username or result:
                self.stats['sniped'] += 1
                logger.info(f"✅ SUKCES! Przechwycono username: {username}")
                
                # Opcjonalnie: wyślij powiadomienie
                await self.send_notification(f"✅ Przechwycono: @{username}")
                return True
        except errors.UsernameOccupiedError:
            logger.warning(f"Username {username} został już zajęty przez kogoś innego (za wolno)")
        except errors.UsernameInvalidError:
            logger.warning(f"Username {username} jest nieprawidłowy")
        except errors.FloodWaitError as e:
            logger.warning(f"Flood wait na {e.seconds} sekund")
            await asyncio.sleep(e.seconds)
        except Exception as e:
            logger.error(f"Błąd podczas przechwytywania {username}: {e}")
            
        return False
        
    async def send_notification(self, message: str):
        """Opcjonalne powiadomienie - można rozszerzyć o wysyłkę na inny chat"""
        try:
            me = await self.client.get_me()
            await self.client.send_message(me.id, message)
        except:
            pass
            
    async def monitor_loop(self):
        """Główna pętla monitorująca"""
        self.running = True
        logger.info(f"Rozpoczęto monitorowanie {len(self.target_usernames)} username'ów")
        
        while self.running:
            for username in self.target_usernames:
                try:
                    self.stats['checks'] += 1
                    
                    # Sprawdź dostępność
                    if await self.check_username(username):
                        logger.info(f"🔍 Znaleziono wolny username: {username}")
                        
                        # Spróbuj przechwycić
                        await self.snipe_username(username)
                        
                    # Małe opóźnienie między sprawdzeniami różnych username'ów
                    await asyncio.sleep(0.1)  # 100ms między różnymi username'ami
                    
                except errors.FloodWaitError as e:
                    logger.warning(f"Flood wait: {e.seconds}s")
                    await asyncio.sleep(e.seconds)
                except Exception as e:
                    logger.error(f"Nieoczekiwany błąd: {e}")
                    
            # Wyświetl statystyki co 100 iteracji
            if self.stats['checks'] % 100 == 0:
                logger.info(f"Statystyki: sprawdzenia={self.stats['checks']}, "
                           f"wolne={self.stats['found_free']}, "
                           f"przechwycone={self.stats['sniped']}, "
                           f"błędy={self.stats['errors']}")
            
            # Główne opóźnienie między pełnymi cyklami
            await asyncio.sleep(self.check_interval)
            
    def stop(self):
        """Zatrzymuje monitorowanie"""
        self.running = False
        logger.info("Monitorowanie zatrzymane")
`;

const MAIN_PY = `import asyncio
import logging
import os
import sys
import signal
from datetime import datetime
from telethon import TelegramClient, errors, events
from telethon.tl.functions.channels import CreateChannelRequest, UpdateUsernameRequest as UpdateChannelUsernameRequest
from telethon.tl.functions.contacts import ResolveUsernameRequest
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Logger configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('sniper.log')
    ]
)
logger = logging.getLogger("SniperBot")

class UsernameSniper:
    def __init__(self):
        self.api_id = int(os.getenv('API_ID', 0))
        self.api_hash = os.getenv('API_HASH', '')
        self.phone = os.getenv('PHONE', '')
        self.string_session = os.getenv('STRING_SESSION', '')
        self.target_usernames = [u.strip().replace('@', '') for u in os.getenv('TARGET_USERNAMES', '').split(',') if u.strip()]
        self.check_interval = float(os.getenv('CHECK_INTERVAL', 0.5))
        
        # Session storage
        os.makedirs('sessions', exist_ok=True)
        self.session_path = 'sessions/bot_session'
        
        # Client initialization
        if self.string_session:
            from telethon.sessions import StringSession
            logger.info("Używanie StringSession do logowania...")
            self.client = TelegramClient(StringSession(self.string_session), self.api_id, self.api_hash)
        else:
            logger.info("Używanie sesji plikowej do logowania...")
            self.client = TelegramClient(self.session_path, self.api_id, self.api_hash)
        
        self.running = False
        self.stats = {'checks': 0, 'sniped': 0, 'errors': 0}

    async def check_and_snipe(self, username):
        try:
            self.stats['checks'] += 1
            # Check if username is occupied
            try:
                await self.client(ResolveUsernameRequest(username))
                # If no exception, it's occupied
                return False
            except errors.UsernameNotOccupiedError:
                # IT'S FREE!
                logger.info(f"🚀 Username @{username} is FREE! Attempting to snipe via CHANNEL...")
                
                try:
                    # 1. Create a new channel
                    created_channel = await self.client(CreateChannelRequest(
                        title=f"Reserved @{username}",
                        about=f"This username @{username} has been sniped by SniperBot.",
                        megagroup=False
                    ))
                    
                    channel = created_channel.chats[0]
                    
                    # 2. Assign the username to the channel
                    await self.client(UpdateChannelUsernameRequest(
                        channel=channel,
                        username=username
                    ))
                    
                    logger.info(f"✅ SUCCESS! Sniped @{username} to a new channel.")
                    self.stats['sniped'] += 1
                    
                    # Send notification to self
                    await self.client.send_message('me', f"✅ **SNIPER SUCCESS (CHANNEL)**\nUsername: @{username}\nTime: {datetime.now()}")
                    
                    # Remove from targets if successful
                    self.target_usernames.remove(username)
                    return True
                except errors.UsernameOccupiedError:
                    logger.warning(f"❌ Too slow! @{username} was taken by someone else.")
                except errors.ChannelsTooMuchError:
                    logger.error("❌ Error: You have too many channels! Cannot create more.")
                    self.running = False # Stop if we can't create more channels
                except Exception as e:
                    logger.error(f"❌ Error while creating channel/updating username @{username}: {e}")
            
        except errors.FloodWaitError as e:
            logger.warning(f"⚠️ FloodWait: Sleeping for {e.seconds}s")
            await asyncio.sleep(e.seconds)
        except Exception as e:
            logger.error(f"❌ Error checking @{username}: {e}")
            self.stats['errors'] += 1
        return False

    async def run(self):
        if not self.api_id or not self.api_hash:
            logger.error("API_ID or API_HASH missing in environment!")
            return

        logger.info("Starting Telegram Sniper Bot...")
        
        try:
            # This handles interactive login if session doesn't exist
            if self.string_session:
                await self.client.connect()
            else:
                await self.client.start(phone=self.phone)
            
            if not await self.client.is_user_authorized():
                logger.error("Client is not authorized. Please run locally first or use terminal.")
                return

            me = await self.client.get_me()
            logger.info(f"Logged in as: {me.first_name} (@{me.username})")
            
            if not self.string_session:
                logger.info(f"TWÓJ STRING SESSION (ZACHOWAJ GO!): {self.client.session.save()}")

            logger.info(f"Targets: {', '.join(['@'+u for u in self.target_usernames])}")
            logger.info(f"Interval: {self.check_interval}s")

            self.running = True
            while self.running and self.target_usernames:
                for username in list(self.target_usernames):
                    await self.check_and_snipe(username)
                    await asyncio.sleep(0.1) # Small delay between targets
                
                if self.stats['checks'] % 50 == 0:
                    logger.info(f"Stats: {self.stats['checks']} checks, {self.stats['sniped']} sniped, {self.stats['errors']} errors")
                
                await asyncio.sleep(self.check_interval)

            if not self.target_usernames:
                logger.info("All targets sniped or list empty. Shutting down.")

        except Exception as e:
            logger.error(f"Fatal error: {e}")
        finally:
            await self.client.disconnect()

    def stop(self):
        self.running = False
        logger.info("Stopping bot...")

async def main():
    bot = UsernameSniper()
    
    def signal_handler():
        bot.stop()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)

    await bot.run()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
`;

const REQUIREMENTS_TXT = `telethon>=1.34.0
python-dotenv>=1.0.0
aiohttp>=3.9.0
cryptg>=0.4.0  # Przyspiesza szyfrowanie MTProto
pysocks>=1.7.1  # Dla proxy SOCKS
`;

const DOCKERFILE = `FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    build-essential \\
    libssl-dev \\
    libffi-dev \\
    python3-dev \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \\
    && apt-get install -y nodejs

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY . .
RUN npm install

# Copy requirements and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Build the frontend
RUN npm run build

# Create directory for sessions
RUN mkdir -p sessions

# Command to run the Node.js server
CMD ["npm", "start"]`;

const RAILWAY_JSON = `{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE"
  },
  "deploy": {
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}`;

const ENV_EXAMPLE = `API_ID=your_api_id
API_HASH=your_api_hash
PHONE=+48123456789
STRING_SESSION=your_string_session_if_available
TARGET_USERNAMES=username1,username2
CHECK_INTERVAL=0.5`;

const README_MD = `# Telegram Username Sniper (Railway Edition)

A robust Python bot to monitor and instantly claim Telegram usernames by creating public channels.

## Features
- **Channel-Based Sniping**: Creates a new public channel for each sniped username (allows holding multiple OG names).
- **24/7 Operation**: Optimized for Railway.app deployment.
- **Fast Sniping**: Uses Telethon's MTProto for low-latency requests.
- **Flood Handling**: Automatically handles Telegram's rate limits.
- **Session Persistence**: Supports StringSession to avoid repeated verification.
- **Dockerized**: Ready-to-use Dockerfile for easy deployment.

## Setup Instructions

### 1. Get Telegram API Credentials
1. Go to [my.telegram.org](https://my.telegram.org).
2. Log in and go to 'API development tools'.
3. Create a new application to get your \`API_ID\` and \`API_HASH\`.

### 2. Local Preparation (Recommended)
It's best to run the bot locally once to generate the session file:
1. Install requirements: \`pip install -r requirements.txt\`
2. Create \`.env\` with your credentials.
3. Run \`python main.py\`.
4. Enter the verification code sent to your Telegram.
5. Once logged in, a file \`sessions/bot_session.session\` will be created.

### 3. Railway Deployment
1. Create a new project on Railway.
2. Connect your GitHub repository.
3. Add the following **Variables** in Railway:
   - \`API_ID\`
   - \`API_HASH\`
   - \`PHONE\`
   - \`TARGET_USERNAMES\` (comma separated)
   - \`CHECK_INTERVAL\` (default 0.5)
4. **Important**: Since Railway's filesystem is ephemeral, you should use a **Volume** mounted to \`/app/sessions\` to persist your login, OR upload your \`bot_session.session\` to the repository (not recommended for security).

### 4. Interactive Login on Railway
If you don't run it locally first:
1. Deploy the bot.
2. Open the **Terminal** tab in Railway for your service.
3. The bot will ask for the code. Type it directly into the Railway terminal.

## Monitoring
Check the **Logs** tab in Railway to see the bot's activity, statistics, and any errors.
`;

const ENGLISH_OG = [
  "ace", "air", "art", "bad", "bag", "bar", "bat", "bed", "bee", "big", "bin", "bit", "box", "boy", "bus", "bye", "can", "cap", "car", "cat", "cup", "cut", "dad", "day", "dog", "dot", "dry", "eat", "egg", "end", "eye", "fan", "far", "fat", "fee", "fly", "for", "fun", "gas", "get", "god", "guy", "hat", "hot", "ice", "ink", "jam", "jar", "jet", "job", "joy", "key", "kid", "lab", "law", "leg", "let", "lid", "lip", "log", "low", "mad", "map", "men", "met", "mix", "mud", "net", "new", "nod", "not", "now", "nut", "odd", "off", "old", "one", "out", "owl", "pad", "pan", "pat", "pay", "pen", "pet", "pie", "pig", "pin", "pot", "pub", "put", "ran", "rat", "raw", "red", "rid", "rob", "rod", "rot", "row", "rub", "rug", "run", "sad", "sat", "saw", "say", "sea", "see", "set", "sew", "she", "shy", "sin", "sip", "sir", "sit", "sky", "sly", "son", "sun", "tap", "tax", "tea", "ten", "the", "tie", "tin", "tip", "toe", "top", "toy", "try", "tub", "tug", "two", "use", "van", "vet", "via", "war", "way", "web", "wed", "wet", "who", "why", "wig", "win", "wit", "yes", "yet", "you", "zoo", "acid", "aged", "also", "area", "army", "away", "baby", "back", "ball", "band", "bank", "base", "bath", "bear", "beat", "been", "beer", "bell", "belt", "best", "bill", "bird", "blow", "blue", "boat", "body", "bomb", "bond", "bone", "book", "boom", "born", "boss", "both", "bowl", "bulk", "burn", "bush", "busy", "cake", "call", "calm", "came", "camp", "card", "care", "case", "cash", "cast", "cell", "chat", "chip", "city", "club", "coal", "coat", "code", "cold", "come", "cook", "cool", "cope", "copy", "core", "cost", "crew", "crop", "dark", "data", "date", "dawn", "days", "dead", "deal", "dean", "dear", "debt", "deep", "deny", "desk", "dial", "diet", "disc", "dish", "does", "done", "door", "dose", "down", "draw", "drew", "drop", "drug", "drum", "dual", "duke", "dust", "duty", "each", "earn", "ease", "east", "easy", "edge", "else", "even", "ever", "evil", "exit", "face", "fact", "fail", "fair", "fall", "farm", "fast", "fate", "fear", "feed", "feel", "feet", "fell", "felt", "file", "fill", "film", "find", "fine", "fire", "firm", "fish", "five", "flat", "flow", "flux", "food", "foot", "ford", "form", "fort", "four", "free", "from", "fuel", "full", "fund", "gain", "game", "gate", "gave", "gear", "gene", "gift", "girl", "give", "glad", "goal", "goes", "gold", "golf", "gone", "good", "gray", "grew", "grey", "grow", "gulf", "hair", "half", "hall", "hand", "hang", "hard", "harm", "hate", "have", "head", "hear", "heat", "held", "hell", "help", "here", "hero", "high", "hill", "hire", "hold", "hole", "holy", "home", "hope", "host", "hour", "huge", "hung", "hunt", "hurt", "idea", "inch", "into", "iron", "item", "jack", "jane", "jean", "john", "join", "jump", "jury", "just", "keen", "keep", "kent", "kept", "kick", "kill", "kind", "king", "knee", "knew", "know", "lack", "lady", "laid", "lake", "land", "lane", "last", "late", "lead", "left", "less", "life", "lift", "like", "line", "link", "list", "live", "load", "loan", "lock", "logo", "long", "look", "lord", "lose", "loss", "lost", "love", "luck", "made", "mail", "main", "make", "male", "many", "mark", "mass", "matt", "meal", "mean", "meat", "meet", "menu", "mere", "mike", "mile", "milk", "mill", "mind", "mine", "miss", "mode", "mood", "moon", "more", "most", "move", "much", "must", "name", "navy", "near", "neck", "need", "news", "next", "nice", "nick", "nine", "none", "nose", "note", "okay", "once", "only", "onto", "open", "oral", "over", "pace", "pack", "page", "paid", "pain", "pair", "palm", "park", "part", "pass", "past", "path", "peak", "pick", "pile", "pink", "pipe", "plan", "play", "plot", "plug", "plus", "poll", "pool", "poor", "port", "post", "pull", "pure", "push", "race", "rail", "rain", "rank", "rare", "rate", "read", "real", "rear", "rely", "rent", "rest", "rice", "rich", "ride", "ring", "rise", "risk", "road", "rock", "role", "roll", "roof", "room", "root", "rose", "rule", "rush", "ruth", "safe", "said", "sake", "sale", "salt", "same", "sand", "save", "seat", "seed", "seek", "seem", "seen", "self", "sell", "send", "sent", "sept", "ship", "shop", "shot", "show", "shut", "sick", "side", "sign", "site", "size", "skin", "slip", "slow", "snow", "soft", "soil", "sold", "sole", "some", "song", "soon", "sort", "soul", "spot", "star", "stay", "step", "stop", "such", "suit", "sure", "take", "tale", "talk", "tall", "tank", "tape", "task", "team", "tech", "tell", "tend", "term", "test", "than", "that", "them", "then", "they", "thin", "this", "thus", "till", "time", "tiny", "told", "toll", "tone", "tony", "took", "tool", "tour", "town", "tree", "trip", "true", "tune", "turn", "twin", "type", "unit", "upon", "used", "user", "vary", "vast", "very", "vice", "view", "vote", "wage", "wait", "wake", "walk", "wall", "want", "ward", "warm", "wash", "wave", "ways", "weak", "wear", "week", "well", "went", "were", "west", "what", "when", "whom", "wide", "wife", "wild", "will", "wind", "wine", "wing", "wire", "wise", "wish", "with", "wood", "word", "wore", "work", "yard", "yeah", "year", "your", "zero", "zone"
];

const POLISH_OG = [
  "as", "at", "bo", "by", "co", "do", "go", "ja", "je", "li", "ma", "mu", "na", "no", "on", "po", "sa", "ta", "te", "to", "tu", "ty", "wy", "za", "ze", "akt", "ale", "ant", "ara", "ark", "asf", "atp", "aut", "bak", "bal", "ban", "bar", "bas", "bat", "bec", "bej", "bek", "bel", "ber", "bez", "bić", "bij", "bis", "bit", "blu", "bob", "boc", "bod", "boj", "bok", "bol", "bon", "bor", "bot", "bób", "bóg", "bój", "ból", "bud", "buk", "bul", "bus", "but", "byt", "być", "bzf", "bzik", "cal", "cap", "car", "cel", "cep", "cer", "ces", "cha", "chi", "cho", "chu", "chy", "cia", "cie", "cię", "cło", "cmf", "cny", "coś", "cud", "cuk", "cup", "cyc", "cyk", "cym", "cyn", "cyp", "cyr", "cyt", "cza", "cze", "czu", "czy", "ćma", "ćmi", "ćpa", "dab", "dak", "dal", "dam", "dan", "dar", "das", "dat", "daj", "dąb", "dąć", "dąż", "dbf", "dęb", "dęć", "dla", "dmf", "dno", "doć", "dog", "doj", "dok", "dol", "dom", "don", "dor", "dot", "doz", "doż", "drf", "dró", "drz", "duć", "duf", "duj", "duk", "dum", "duo", "dur", "dus", "duś", "duż", "dwa", "dwi", "dwu", "dyf", "dyg", "dym", "dyn", "dyr", "dys", "dyś", "dyz", "dyż", "dza", "dze", "dzi", "dzo", "dzu", "dzy", "dźw", "dża", "dże", "dżi", "dżo", "dżu", "dży", "ech", "eco", "edp", "efr", "ego", "egz", "eja", "ejż", "eka", "eko", "eks", "ekt", "ela", "elf", "elk", "elm", "elo", "elu", "ełk", "ema", "emi", "emo", "emu", "emy", "end", "ent", "enz", "eon", "epa", "era", "erg", "ero", "erp", "err", "ery", "esa", "ese", "esk", "eso", "esu", "esy", "esz", "eta", "etf", "etm", "eto", "etr", "ety", "ewa", "ewu", "ewy", "eza", "eze", "ezi", "ezo", "ezu", "ezy", "fab", "fag", "faj", "fak", "fal", "fan", "far", "fas", "fat", "faz", "fał", "fąf", "fbi", "fca", "fce", "fci", "fco", "fcu", "fcy", "fcz", "fdr", "feb", "fef", "feg", "fej", "fek", "fel", "fem", "fen", "fer", "fes", "fet", "fez", "fęf", "fia", "fic", "fid", "fif", "fig", "fij", "fik", "fil", "fim", "fin", "fio", "fip", "fir", "fis", "fit", "fiut", "fiz", "fiż", "fla", "fle", "fli", "flo", "flu", "fly", "fob", "foc", "fof", "fog", "foj", "fok", "fol", "fom", "fon", "for", "fos", "fot", "foz", "foż", "fra", "fre", "fri", "fro", "fru", "fry", "fsa", "fse", "fsi", "fso", "fsu", "fsy", "fta", "fte", "fti", "fto", "ftu", "fty", "fua", "fub", "fuc", "fud", "fuf", "fug", "fuj", "fuk", "ful", "fum", "fun", "fuo", "fur", "fus", "fut", "fuz", "fuż", "fya", "fye", "fyi", "fyo", "fyu", "fyy", "fza", "fze", "fzi", "fzo", "fzu", "fzy", "gab", "gac", "gad", "gaf", "gag", "gaj", "gak", "gal", "gam", "gan", "gap", "gar", "gas", "gat", "gaz", "gaż", "gąb", "gąd", "gąf", "gąg", "gąj", "gąk", "gąl", "gąm", "gąn", "gąp", "gąr", "gąs", "gąt", "gąz", "gąż", "gda", "gde", "gdi", "gdo", "gdu", "gdy", "gdz", "geb", "gec", "ged", "gef", "geg", "gej", "gek", "gel", "gem", "gen", "gep", "ger", "ges", "get", "gez", "geż", "gęba", "gęć", "gęd", "gęf", "gęg", "gęj", "gęk", "gęl", "gęm", "gęn", "gęp", "gęr", "gęs", "gęt", "gęz", "gęż", "gia", "gic", "gid", "gif", "gig", "gij", "gik", "gil", "gim", "gin", "gio", "gip", "gir", "gis", "git", "giz", "giż", "gla", "gle", "gli", "glo", "glu", "gly", "gła", "głe", "głi", "gło", "głu", "gły", "gna", "gne", "gni", "gno", "gnu", "gny", "gob", "goc", "god", "gof", "gog", "goj", "gok", "gol", "gom", "gon", "gop", "gor", "gos", "got", "goz", "goż", "gra", "gre", "gri", "gro", "gru", "gry", "gsa", "gse", "gsi", "gso", "gsu", "gsy", "gta", "gte", "gti", "gto", "gtu", "gty", "gua", "gub", "guc", "gud", "guf", "gug", "guj", "guk", "gul", "gum", "gun", "guo", "gur", "gus", "gut", "guz", "guż", "gya", "gye", "gyi", "gyo", "gyu", "gyy", "gza", "gze", "gzi", "gzo", "gzu", "gzy", "hab", "hac", "had", "haf", "hag", "haj", "hak", "hal", "ham", "han", "hap", "har", "has", "hat", "haz", "haż", "hąb", "hąd", "hąf", "hąg", "hąj", "hąk", "hąl", "hąm", "hąn", "hąp", "hąr", "hąs", "hąt", "hąz", "hąż", "hda", "hde", "hdi", "hdo", "hdu", "hdy", "hdz", "heb", "hec", "hed", "hef", "heg", "hej", "hek", "hel", "hem", "hen", "hep", "her", "hes", "het", "hez", "heż", "hęc", "hęć", "hęd", "hęf", "hęg", "hęj", "hęk", "hęl", "hęm", "hęn", "hęp", "hęr", "hęs", "hęt", "hęz", "hęż", "hia", "hic", "hid", "hif", "hig", "hij", "hik", "hil", "him", "hin", "hio", "hip", "hir", "his", "hit", "hiz", "hiż", "hla", "hle", "hli", "hlo", "hlu", "hly", "hła", "hłe", "hłi", "hło", "hłu", "hły", "hna", "hne", "hni", "hno", "hnu", "hny", "hob", "hoc", "hod", "hof", "hog", "hoj", "hok", "hol", "hom", "hon", "hop", "hor", "hos", "hot", "hoz", "hoż", "hra", "hre", "hri", "hro", "hru", "hry", "hsa", "hse", "hsi", "hso", "hsu", "hsy", "hta", "hte", "hti", "hto", "htu", "hty", "hua", "hub", "huc", "hud", "huf", "hug", "huj", "huk", "hul", "hum", "hun", "huo", "hur", "hus", "hut", "huz", "huż", "hya", "hye", "hyi", "hyo", "hyu", "hyy", "hza", "hze", "hzi", "hzo", "hzu", "hzy", "iba", "ibe", "ibi", "ibo", "ibu", "iby", "ich", "idą", "idę", "idź", "igf", "igła", "igo", "igp", "igry", "igu", "igy", "ija", "ije", "iji", "ijo", "iju", "ijy", "ika", "ike", "iki", "iko", "iku", "iky", "ila", "ile", "ili", "ilo", "ilu", "ily", "iłf", "iła", "iłe", "iłm", "iło", "iłp", "iłu", "iły", "ima", "ime", "imi", "imo", "imu", "imy", "ina", "inc", "ind", "inf", "ing", "ini", "ink", "inm", "inn", "ino", "inp", "inr", "ins", "int", "inu", "iny", "inz", "inż", "ipa", "ipe", "ipi", "ipo", "ipu", "ipy", "ira", "ire", "iri", "iro", "iru", "iry", "isa", "ise", "isi", "iso", "isu", "isy", "isz", "ita", "ite", "iti", "ito", "itu", "ity", "iwa", "iwe", "iwi", "iwo", "iwu", "iwy", "iza", "ize", "izi", "izo", "izu", "izy", "iża", "iże", "iżi", "iżo", "iżu", "iży"
];

export default function App() {
  const [activeTab, setActiveTab] = useState('config');
  const [activeFile, setActiveFile] = useState('main.py');
  const [copied, setCopied] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Config state
  const [apiId, setApiId] = useState(() => localStorage.getItem('apiId') || '34215345');
  const [apiHash, setApiHash] = useState(() => localStorage.getItem('apiHash') || '1603428aaca7a813dea9a598c3276e61');
  const [phone, setPhone] = useState(() => localStorage.getItem('phone') || '+45 575911355');
  const [telegramBotToken, setTelegramBotToken] = useState(() => localStorage.getItem('telegramBotToken') || '');
  const [telegramChatId, setTelegramChatId] = useState(() => localStorage.getItem('telegramChatId') || '');
  const [usernames, setUsernames] = useState(() => localStorage.getItem('usernames') || '');
  const [delay, setDelay] = useState(() => localStorage.getItem('delay') || '0.5');
  const [stringSession, setStringSession] = useState(() => localStorage.getItem('stringSession') || '');
  const [useProxy, setUseProxy] = useState(() => localStorage.getItem('useProxy') === 'true');
  const [proxyType, setProxyType] = useState(() => localStorage.getItem('proxyType') || 'socks5');
  const [proxyHost, setProxyHost] = useState(() => localStorage.getItem('proxyHost') || '');
  const [proxyPort, setProxyPort] = useState(() => localStorage.getItem('proxyPort') || '');
  const [databaseUrl, setDatabaseUrl] = useState(() => localStorage.getItem('databaseUrl') || '');

  // Name Generator State
  const [genLength, setGenLength] = useState(4);
  const [genCount, setGenCount] = useState(20);
  const [genCategory, setGenCategory] = useState('Technologia');

  // Auth state
  const [authStep, setAuthStep] = useState<'idle' | 'sending' | 'waiting' | 'signing' | 'password'>('idle');
  const [authCode, setAuthCode] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  const handleSendCode = async () => {
    if (!phone || !apiId || !apiHash) {
      setAuthError('Wypełnij API ID, API Hash i Numer Telefonu!');
      return;
    }
    setAuthStep('sending');
    setAuthError('');
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, apiId, apiHash })
      });
      const data = await res.json();
      if (data.success) {
        setAuthStep('waiting');
      } else {
        setAuthError(data.error || 'Błąd wysyłania kodu');
        setAuthStep('idle');
      }
    } catch (e: any) {
      if (e.message.includes('TIMEOUT')) {
        setAuthError('Błąd: Przekroczono czas połączenia (TIMEOUT). Telegram nie odpowiada. Spróbuj ponownie za chwilę.');
      } else {
        setAuthError(e.message);
      }
      setAuthStep('idle');
    }
  };

  const handleSignIn = async () => {
    if (!authCode) {
      setAuthError('Wpisz kod weryfikacyjny!');
      return;
    }
    setAuthStep('signing');
    setAuthError('');
    try {
      const res = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: authCode, password: authPassword, apiId, apiHash })
      });
      const data = await res.json();
      if (data.requiresPassword) {
        setAuthStep('password');
        return;
      }
      if (data.stringSession) {
        setStringSession(data.stringSession);
        setAuthStep('idle');
        setAuthCode('');
        setAuthPassword('');
        alert('Zalogowano pomyślnie! StringSession został zapisany.');
      } else {
        setAuthError(data.error || 'Błąd logowania');
        setAuthStep('waiting');
      }
    } catch (e: any) {
      if (e.message.includes('TIMEOUT')) {
        setAuthError('Błąd: Przekroczono czas połączenia (TIMEOUT). Spróbuj ponownie.');
      } else {
        setAuthError(e.message);
      }
      setAuthStep('waiting');
    }
  };

  const testConnection = async () => {
    if (!stringSession) {
      alert('Najpierw wygeneruj lub wklej StringSession!');
      return;
    }
    setIsTesting(true);
    try {
      const res = await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          mode: 'simulation', 
          config: { apiId, apiHash, phone, stringSession, usernames: 'test', delay: '1' } 
        })
      });
      const data = await res.json();
      setTimeout(async () => {
        const statusRes = await fetch('/api/status');
        const status = await statusRes.json();
        const lastLog = status.botLogs[status.botLogs.length - 1];
        if (lastLog.includes('Zalogowano jako')) {
          alert('Połączenie udane! ' + lastLog);
        } else {
          alert('Błąd połączenia: ' + lastLog);
        }
        await fetch('/api/bot/stop', { method: 'POST' });
        setIsTesting(false);
      }, 3000);
    } catch (e: any) {
      alert('Błąd testu: ' + e.message);
      setIsTesting(false);
    }
  };

  const CATEGORIES = [
    "Technologia", "Zdrowie", "Edukacja", "Biznes", "Finanse", "Sport", "Rozrywka", 
    "Podróże", "Jedzenie", "Moda", "Motoryzacja", "Gry", "Nauka", "Sztuka", 
    "Muzyka", "Film i telewizja", "Dom i ogród", "Styl życia", "Zwierzęta", "Ekologia"
  ];

  const resetConfig = () => {
    if (window.confirm('Czy na pewno chcesz zresetować całą konfigurację?')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  const [isGenerating, setIsGenerating] = useState(false);

  const generateRandomNames = async () => {
    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Generate ${genCount} unique, creative, and similar brand names for the category: ${genCategory}. Each name should be around ${genLength} characters long.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              names: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of generated brand names",
              },
            },
            required: ["names"],
          },
        },
      });
      const data = JSON.parse(response.text!);
      const results = data.names;
      setUsernames(prev => prev ? `${prev}, ${results.join(', ')}` : results.join(', '));
    } catch (error) {
      console.error("Error generating names:", error);
      alert("Wystąpił błąd podczas generowania nazw. Spróbuj ponownie.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Persistence Logic
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/config');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          throw new Error("Received non-JSON response from server");
        }
        const config = await response.json();
        if (config.apiId) setApiId(config.apiId);
        if (config.apiHash) setApiHash(config.apiHash);
        if (config.phone) setPhone(config.phone);
        if (config.telegramBotToken) setTelegramBotToken(config.telegramBotToken);
        if (config.telegramChatId) setTelegramChatId(config.telegramChatId);
        if (config.usernames) setUsernames(config.usernames);
        if (config.delay) setDelay(config.delay);
        if (config.stringSession) setStringSession(config.stringSession);
        if (config.useProxy) setUseProxy(config.useProxy === 'true');
        if (config.proxyType) setProxyType(config.proxyType);
        if (config.proxyHost) setProxyHost(config.proxyHost);
        if (config.proxyPort) setProxyPort(config.proxyPort);
        if (config.databaseUrl) setDatabaseUrl(config.databaseUrl);
      } catch (error) {
        console.error('Failed to fetch config:', error);
      }
    };
    fetchConfig();
  }, []);

  useEffect(() => {
    localStorage.setItem('apiId', apiId);
    localStorage.setItem('apiHash', apiHash);
    localStorage.setItem('phone', phone);
    localStorage.setItem('telegramBotToken', telegramBotToken);
    localStorage.setItem('telegramChatId', telegramChatId);
    localStorage.setItem('usernames', usernames);
    localStorage.setItem('delay', delay);
    localStorage.setItem('stringSession', stringSession);
    localStorage.setItem('useProxy', String(useProxy));
    localStorage.setItem('proxyType', proxyType);
    localStorage.setItem('proxyHost', proxyHost);
    localStorage.setItem('proxyPort', proxyPort);
    localStorage.setItem('databaseUrl', databaseUrl);

    // Save to server with debounce
    const timeout = setTimeout(async () => {
      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiId, apiHash, phone, telegramBotToken, telegramChatId,
            usernames, delay, stringSession, useProxy, proxyType,
            proxyHost, proxyPort, databaseUrl
          })
        });
      } catch (error) {
        console.error('Failed to save config:', error);
      }
    }, 1000);

    return () => clearTimeout(timeout);
  }, [apiId, apiHash, phone, telegramBotToken, telegramChatId, usernames, delay, stringSession, useProxy, proxyType, proxyHost, proxyPort, databaseUrl]);

  // Bot Simulation State (now fetched from backend)
  const [isBotRunning, setIsBotRunning] = useState(false);
  const [botMode, setBotMode] = useState<'capture' | 'simulation'>('capture');
  const [botLogs, setBotLogs] = useState<string[]>(['[SYSTEM] Ładowanie...']);
  const [botStats, setBotStats] = useState({
    checks: 0,
    claims: 0,
    uptime: 0,
    lastCheck: 'Nigdy'
  });

  // Fetch status from backend
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch('/api/status');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          throw new Error("Received non-JSON response from server");
        }
        const data = await response.json();
        setIsBotRunning(data.isBotRunning);
        setBotMode(data.botMode);
        setBotLogs(data.botLogs);
        setBotStats(data.botStats);
      } catch (error) {
        console.error('Failed to fetch status:', error);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const toggleBot = async (action: 'start' | 'stop') => {
    try {
      const config = {
        apiId,
        apiHash,
        phone,
        telegramBotToken,
        telegramChatId,
        usernames,
        delay,
        stringSession,
        useProxy,
        proxyType,
        proxyHost,
        proxyPort
      };
      await fetch(`/api/bot/${action}`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: botMode, config })
      });
      // Status will be updated by the useEffect interval
    } catch (error) {
      console.error('Failed to toggle bot:', error);
    }
  };

  const generateEnvContent = () => {
    const usernameList = usernames
      .split(',')
      .map(u => u.trim().replace('@', ''))
      .filter(u => u.length > 0)
      .join(',');

    let env = `API_ID=${apiId || '0'}
API_HASH=${apiHash || ''}
PHONE=${phone || ''}
TELEGRAM_BOT_TOKEN=${telegramBotToken || ''}
TELEGRAM_CHAT_ID=${telegramChatId || ''}
DATABASE_URL=${databaseUrl || ''}
STRING_SESSION=${stringSession || ''}
SESSION_FILE=accounts/main
TARGET_USERNAMES=${usernameList}
CHECK_INTERVAL=${delay || '0.5'}
`;

    if (useProxy && proxyHost && proxyPort) {
      env += `PROXY=${proxyType}://${proxyHost}:${proxyPort}\n`;
    }

    return env;
  };

  const getActiveFileContent = () => {
    switch (activeFile) {
      case 'main.py': return MAIN_PY;
      case 'Dockerfile': return DOCKERFILE;
      case 'requirements.txt': return REQUIREMENTS_TXT;
      case 'railway.json': return RAILWAY_JSON;
      case '.env.example': return ENV_EXAMPLE;
      case 'README.md': return README_MD;
      case '.env': return generateEnvContent();
      default: return '';
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = (filename: string, content: string) => {
    const element = document.createElement("a");
    const file = new Blob([content], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="h-screen bg-[#0a0a0a] text-gray-200 font-sans flex flex-col md:flex-row overflow-hidden">
      {/* Mobile Header */}
      <div className="md:hidden bg-[#111111] border-b border-white/10 p-4 flex items-center justify-between z-20">
        <div className="flex items-center gap-3 text-emerald-500">
          <Terminal size={24} />
          <h1 className="font-bold text-lg tracking-tight text-white">TG Sniper</h1>
        </div>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-gray-400 hover:text-white">
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-[#111111] border-r border-white/10 flex flex-col transform transition-transform duration-300 ease-in-out
        md:relative md:translate-x-0
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-6 border-b border-white/10 flex justify-between items-center">
          <div>
            <div className="flex items-center gap-3 text-emerald-500 mb-2">
              <Terminal size={24} />
              <h1 className="font-bold text-lg tracking-tight text-white">TG Sniper</h1>
            </div>
            <p className="text-xs text-gray-500 font-mono">v2.0.0 Modular</p>
          </div>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <button 
            onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'dashboard' ? 'bg-emerald-500/10 text-emerald-400' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}`}
          >
            <Activity size={18} />
            <span className="font-medium text-sm">Panel Sterowania</span>
          </button>
          <button 
            onClick={() => { setActiveTab('config'); setIsMobileMenuOpen(false); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'config' ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}`}
          >
            <Settings size={18} />
            <span className="font-medium text-sm">Konfigurator</span>
          </button>
          <button 
            onClick={() => { setActiveTab('code'); setIsMobileMenuOpen(false); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'code' ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}`}
          >
            <FileCode2 size={18} />
            <span className="font-medium text-sm">Kod Źródłowy</span>
          </button>
          <button 
            onClick={() => { setActiveTab('instructions'); setIsMobileMenuOpen(false); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'instructions' ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}`}
          >
            <BookOpen size={18} />
            <span className="font-medium text-sm">Instrukcja</span>
          </button>
          <button 
            onClick={() => { setActiveTab('names'); setIsMobileMenuOpen(false); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'names' ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}`}
          >
            <FileText size={18} />
            <span className="font-medium text-sm">Baza Nazw</span>
          </button>
          
          <div className="pt-4">
            <button 
              onClick={() => { resetConfig(); setIsMobileMenuOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400/60 hover:bg-red-500/10 hover:text-red-400 transition-all"
            >
              <RefreshCw size={18} />
              <span className="font-medium text-sm">Resetuj Dane</span>
            </button>
          </div>
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2">
            <ShieldAlert size={16} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-500/90 leading-relaxed">
              Używaj na własne ryzyko. Zbyt niski interwał może skutkować banem konta.
            </p>
          </div>
        </div>
      </div>

      {/* Overlay for mobile */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-20 md:hidden backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative z-0">
        <div className="flex-1 overflow-y-auto p-6 md:p-10">
          <div className="max-w-5xl mx-auto">
            
            {/* DASHBOARD TAB */}
            {activeTab === 'dashboard' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-semibold text-white mb-2">Panel Sterowania Botem</h2>
                    <p className="text-gray-400 text-sm">Monitoruj pracę bota w czasie rzeczywistym i zarządzaj jego stanem.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center bg-black/50 border border-white/10 rounded-xl p-1">
                      <button 
                        onClick={() => setBotMode('capture')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${botMode === 'capture' ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}
                      >
                        Przechwytywanie
                      </button>
                      <button 
                        onClick={() => setBotMode('simulation')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${botMode === 'simulation' ? 'bg-amber-500/20 text-amber-400' : 'text-gray-500 hover:text-gray-300'}`}
                      >
                        Symulacja
                      </button>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${isBotRunning ? 'bg-emerald-500/10 text-emerald-500 animate-pulse' : 'bg-red-500/10 text-red-500'}`}>
                      <div className={`w-2 h-2 rounded-full ${isBotRunning ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                      {isBotRunning ? 'BOT DZIAŁA' : 'BOT WYŁĄCZONY'}
                    </div>
                    <button 
                      onClick={() => toggleBot(isBotRunning ? 'stop' : 'start')}
                      className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg ${isBotRunning ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20' : 'bg-emerald-500 hover:bg-emerald-600 text-black shadow-emerald-500/20'}`}
                    >
                      {isBotRunning ? <Square size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                      {isBotRunning ? 'Zatrzymaj Bota' : 'Uruchom Bota'}
                    </button>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-[#151515] border border-white/10 rounded-2xl p-5">
                    <div className="flex items-center gap-3 text-gray-400 mb-3">
                      <RefreshCw size={18} className={isBotRunning ? 'animate-spin' : ''} />
                      <span className="text-sm font-medium">Liczba Sprawdzeń</span>
                    </div>
                    <div className="text-3xl font-bold text-white">{botStats.checks.toLocaleString()}</div>
                  </div>
                  <div className="bg-[#151515] border border-white/10 rounded-2xl p-5">
                    <div className="flex items-center gap-3 text-emerald-400 mb-3">
                      <Zap size={18} />
                      <span className="text-sm font-medium">Przejęte Nazwy</span>
                    </div>
                    <div className="text-3xl font-bold text-white">{botStats.claims}</div>
                  </div>
                  <div className="bg-[#151515] border border-white/10 rounded-2xl p-5">
                    <div className="flex items-center gap-3 text-blue-400 mb-3">
                      <Clock size={18} />
                      <span className="text-sm font-medium">Czas Pracy</span>
                    </div>
                    <div className="text-3xl font-bold text-white">
                      {Math.floor(botStats.uptime / 60)}m {botStats.uptime % 60}s
                    </div>
                  </div>
                  <div className="bg-[#151515] border border-white/10 rounded-2xl p-5">
                    <div className="flex items-center gap-3 text-purple-400 mb-3">
                      <Shield size={18} />
                      <span className="text-sm font-medium">Ostatni Check</span>
                    </div>
                    <div className="text-3xl font-bold text-white text-lg truncate">{botStats.lastCheck}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Console */}
                  <div className="lg:col-span-2 flex flex-col gap-4">
                    <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl overflow-hidden flex flex-col h-[450px] shadow-2xl">
                      <div className="bg-[#151515] px-4 py-3 border-b border-white/10 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Terminal size={16} className="text-gray-500" />
                          <span className="text-xs font-mono text-gray-400">bot_console.log</span>
                        </div>
                        <button 
                          onClick={() => setBotLogs(['[SYSTEM] Konsola wyczyszczona.'])}
                          className="text-xs text-gray-500 hover:text-white transition-colors"
                        >
                          Wyczyść logi
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-1 bg-black/40">
                        {botLogs.map((log, i) => (
                          <div key={i} className={`
                            ${log.includes('[ERROR]') ? 'text-red-400' : ''}
                            ${log.includes('[SYSTEM]') ? 'text-blue-400' : ''}
                            ${log.includes('!!! SUKCES !!!') ? 'text-emerald-400 font-bold bg-emerald-500/10 px-2 py-1 rounded' : 'text-gray-400'}
                          `}>
                            {log}
                          </div>
                        ))}
                        <div className="h-1" />
                      </div>
                    </div>
                  </div>

                  {/* Config Summary */}
                  <div className="space-y-6">
                    <div className="bg-[#151515] border border-white/10 rounded-2xl p-6">
                      <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                        <Settings size={18} className="text-gray-400" />
                        Aktywna Konfiguracja
                      </h3>
                      <div className="space-y-4">
                        <div>
                          <div className="text-xs text-gray-500 uppercase mb-1">Monitorowane Nazwy</div>
                          <div className="flex flex-wrap gap-1.5">
                            {usernames.split(',').filter(u => u.trim()).slice(0, 10).map((u, i) => (
                              <span key={i} className="px-2 py-0.5 bg-white/5 rounded text-[10px] text-gray-400">@{u.trim().replace('@', '')}</span>
                            ))}
                            {usernames.split(',').filter(u => u.trim()).length > 10 && (
                              <span className="text-[10px] text-gray-500">+{usernames.split(',').filter(u => u.trim()).length - 10} więcej</span>
                            )}
                            {!usernames.trim() && <span className="text-xs text-red-400/60 italic">Brak nazw!</span>}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-xs text-gray-500 uppercase mb-1">Interwał</div>
                            <div className="text-sm text-white font-mono">{delay}s</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500 uppercase mb-1">Proxy</div>
                            <div className="text-sm text-white font-mono">{useProxy ? 'Włączone' : 'Wyłączone'}</div>
                          </div>
                        </div>
                        <div className="pt-4 border-t border-white/5">
                          <button 
                            onClick={() => setActiveTab('config')}
                            className="w-full py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-medium transition-colors text-gray-300"
                          >
                            Zmień ustawienia
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="bg-[#151515] border border-white/10 rounded-2xl p-6">
                      <h3 className="text-sm font-semibold text-emerald-400 mb-2 flex items-center gap-2">
                        <Zap size={16} />
                        Tryb Przechwytywania
                      </h3>
                      <p className="text-xs text-gray-400 leading-relaxed">
                        Bot tworzy <b>nowy kanał publiczny</b> dla każdej przechwyconej nazwy. Pozwala to na trzymanie wielu nazw OG na jednym koncie (personalny profil ma limit 1 nazwy).
                      </p>
                    </div>

                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-6">
                      <h3 className="text-sm font-semibold text-emerald-400 mb-2 flex items-center gap-2">
                        <Zap size={16} />
                        Tryb Symulacji
                      </h3>
                      <p className="text-xs text-emerald-400/70 leading-relaxed">
                        Ten panel służy do testowania logiki i wizualizacji pracy bota. Aby uruchomić prawdziwego snajpera 24/7, użyj kodu z zakładki "Kod Źródłowy" i wdroż go na Railway.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* CONFIGURATOR TAB */}
            {activeTab === 'config' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div>
                  <h2 className="text-2xl font-semibold text-white mb-2">Konfiguracja Bota (.env)</h2>
                  <p className="text-gray-400 text-sm">Wypełnij dane, aby wygenerować plik środowiskowy .env.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4 bg-[#151515] p-6 rounded-2xl border border-white/5">
                    <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider mb-4">Dane API Telegrama</h3>
                    
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">API ID</label>
                      <input 
                        type="text" 
                        value={apiId}
                        onChange={(e) => setApiId(e.target.value)}
                        placeholder="np. 1234567"
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">API Hash</label>
                      <input 
                        type="text" 
                        value={apiHash}
                        onChange={(e) => setApiHash(e.target.value)}
                        placeholder="np. 0123456789abcdef0123456789abcdef"
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Numer telefonu (z kierunkowym)</label>
                      <input 
                        type="text" 
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="np. +48123456789"
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Telegram Bot Token</label>
                      <input 
                        type="text" 
                        value={telegramBotToken}
                        onChange={(e) => setTelegramBotToken(e.target.value)}
                        placeholder="np. 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Telegram Chat ID</label>
                      <input 
                        type="text" 
                        value={telegramChatId}
                        onChange={(e) => setTelegramChatId(e.target.value)}
                        placeholder="np. 123456789"
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Database URL (PostgreSQL)</label>
                      <input 
                        type="text" 
                        value={databaseUrl}
                        onChange={(e) => setDatabaseUrl(e.target.value)}
                        placeholder="postgresql://user:password@host:port/dbname"
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">String Session (Opcjonalne)</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          value={stringSession}
                          onChange={(e) => setStringSession(e.target.value)}
                          placeholder="np. 1BJWap1wBu..."
                          className="flex-1 bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
                        />
                        <button 
                          onClick={testConnection}
                          disabled={isTesting}
                          className="px-3 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium transition-all text-gray-400 hover:text-white disabled:opacity-50"
                        >
                          {isTesting ? 'Testowanie...' : 'Testuj'}
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-500 mt-1.5">Użyj StringSession, aby uniknąć logowania kodem SMS przy każdym restarcie na Railway.</p>
                    </div>

                    {/* Auth Helper */}
                    <div className="pt-4 border-t border-white/5 space-y-3">
                      <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Generator Sesji</h4>
                      <p className="text-[10px] text-gray-500">Jeśli nie masz StringSession, możesz go wygenerować tutaj logując się do konta.</p>
                      
                      {authError && (
                        <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400">
                          {authError}
                        </div>
                      )}

                      {authStep === 'idle' && (
                        <button 
                          onClick={handleSendCode}
                          className="w-full py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-lg text-xs font-bold transition-all"
                        >
                          Wyślij kod weryfikacyjny
                        </button>
                      )}

                      {(authStep === 'waiting' || authStep === 'signing' || authStep === 'password') && (
                        <div className="space-y-2">
                          <input 
                            type="text" 
                            value={authCode}
                            onChange={(e) => setAuthCode(e.target.value)}
                            placeholder="Wpisz kod z Telegrama"
                            className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-all font-mono"
                          />
                          {authStep === 'password' && (
                            <input 
                              type="password" 
                              value={authPassword}
                              onChange={(e) => setAuthPassword(e.target.value)}
                              placeholder="Wpisz hasło 2FA"
                              className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-all font-mono"
                            />
                          )}
                          <button 
                            onClick={handleSignIn}
                            disabled={authStep === 'signing'}
                            className="w-full py-2 bg-emerald-500 text-black rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                          >
                            {authStep === 'signing' ? 'Logowanie...' : 'Zaloguj i pobierz sesję'}
                          </button>
                          <button 
                            onClick={() => setAuthStep('idle')}
                            className="w-full py-1 text-[10px] text-gray-500 hover:text-gray-300 transition-all"
                          >
                            Anuluj
                          </button>
                        </div>
                      )}

                      {authStep === 'sending' && (
                        <div className="text-center py-2 text-xs text-gray-500 animate-pulse">
                          Wysyłanie kodu...
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4 bg-[#151515] p-6 rounded-2xl border border-white/5">
                    <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider mb-4">Ustawienia Snajpera</h3>
                    
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Usernames (po przecinku)</label>
                      <textarea 
                        value={usernames}
                        onChange={(e) => setUsernames(e.target.value)}
                        placeholder="np. crypto, bitcoin, nft"
                        rows={3}
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono resize-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Interwał sprawdzania (sekundy)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        min="0.1"
                        value={delay}
                        onChange={(e) => setDelay(e.target.value)}
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
                      />
                      <p className="text-[10px] text-gray-500 mt-1.5">Zalecane: 0.5 - 1.0s. Zbyt niska wartość spowoduje FloodWait.</p>
                    </div>
                  </div>
                </div>

                {/* Proxy Settings */}
                <div className="bg-[#151515] p-6 rounded-2xl border border-white/5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider">Ustawienia Proxy (Opcjonalne)</h3>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={useProxy} onChange={() => setUseProxy(!useProxy)} />
                      <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>

                  {useProxy && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-in fade-in duration-300">
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Typ</label>
                        <select 
                          value={proxyType}
                          onChange={(e) => setProxyType(e.target.value)}
                          className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-all"
                        >
                          <option value="socks5">SOCKS5</option>
                          <option value="http">HTTP</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Host / IP</label>
                        <input type="text" value={proxyHost} onChange={(e) => setProxyHost(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-all font-mono" placeholder="127.0.0.1" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1.5">Port</label>
                        <input type="text" value={proxyPort} onChange={(e) => setProxyPort(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-all font-mono" placeholder="1080" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Generated ENV Preview */}
                <div className="mt-8">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-gray-300">Wygenerowany plik .env</h3>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => copyToClipboard(generateEnvContent())}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-md text-xs font-medium transition-colors"
                      >
                        {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                        {copied ? 'Skopiowano' : 'Kopiuj'}
                      </button>
                      <button 
                        onClick={() => downloadFile('.env', generateEnvContent())}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 rounded-md text-xs font-medium transition-colors"
                      >
                        <Download size={14} />
                        Pobierz .env
                      </button>
                    </div>
                  </div>
                  <div className="bg-[#0a0a0a] border border-white/10 rounded-xl overflow-hidden">
                    <pre className="p-4 text-sm font-mono text-emerald-400/90 overflow-x-auto whitespace-pre-wrap">
                      {generateEnvContent()}
                    </pre>
                  </div>
                </div>
              </div>
            )}

            {/* SOURCE CODE TAB */}
            {activeTab === 'code' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-semibold text-white mb-2">Kod Źródłowy Bota</h2>
                    <p className="text-gray-400 text-sm">Bot został podzielony na moduły. Pobierz wszystkie pliki i umieść w jednym folderze.</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button 
                      onClick={() => downloadFile(activeFile, getActiveFileContent())}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black rounded-lg text-sm font-semibold transition-colors shadow-[0_0_15px_rgba(16,185,129,0.3)]"
                    >
                      <Download size={16} />
                      Pobierz {activeFile}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 h-[600px]">
                  {/* File Explorer */}
                  <div className="md:col-span-1 bg-[#151515] border border-white/10 rounded-xl p-3 flex flex-col gap-1">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-2">Pliki projektu</div>
                    
                    {['main.py', 'Dockerfile', 'requirements.txt', 'railway.json', '.env.example', 'README.md', '.env'].map(file => (
                      <button
                        key={file}
                        onClick={() => setActiveFile(file)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${activeFile === file ? 'bg-emerald-500/10 text-emerald-400 font-medium' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}`}
                      >
                        <FileText size={16} className={activeFile === file ? 'text-emerald-500' : 'text-gray-500'} />
                        {file}
                      </button>
                    ))}
                  </div>

                  {/* Code Editor */}
                  <div className="md:col-span-3 bg-[#151515] border border-white/10 rounded-xl overflow-hidden flex flex-col">
                    <div className="bg-[#111] px-4 py-2 border-b border-white/10 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                          <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
                          <div className="w-3 h-3 rounded-full bg-emerald-500/80"></div>
                        </div>
                        <span className="text-xs text-gray-400 font-mono ml-2">{activeFile}</span>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(getActiveFileContent())}
                        className="text-gray-500 hover:text-white transition-colors"
                        title="Kopiuj kod"
                      >
                        {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                      </button>
                    </div>
                    <div className="flex-1 overflow-auto p-4">
                      <pre className="text-sm font-mono text-gray-300 leading-relaxed">
                        <code>{getActiveFileContent()}</code>
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* INSTRUCTIONS TAB */}
            {activeTab === 'instructions' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div>
                  <h2 className="text-2xl font-semibold text-white mb-2">Instrukcja Uruchomienia</h2>
                  <p className="text-gray-400 text-sm">Krok po kroku jak uruchomić bota modułowego.</p>
                </div>

                <div className="space-y-6">
                  {/* Step 1 */}
                  <div className="bg-[#151515] border border-white/5 rounded-2xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                    <h3 className="text-lg font-medium text-white mb-3 flex items-center gap-2">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-500 text-xs font-bold">1</span>
                      Przygotowanie plików
                    </h3>
                    <p className="text-gray-400 text-sm mb-4">Utwórz nowy folder i pobierz do niego wszystkie pliki z zakładki "Kod Źródłowy".</p>
                    <div className="bg-black/50 p-4 rounded-lg border border-white/5 font-mono text-sm text-gray-400">
                      my_sniper_bot/<br/>
                      ├── main.py<br/>
                      ├── sniper.py<br/>
                      ├── logger.py<br/>
                      ├── requirements.txt<br/>
                      └── .env
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="bg-[#151515] border border-white/5 rounded-2xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                    <h3 className="text-lg font-medium text-white mb-3 flex items-center gap-2">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-500 text-xs font-bold">2</span>
                      Instalacja bibliotek
                    </h3>
                    <p className="text-gray-400 text-sm mb-4">Zainstaluj wymagane pakiety używając pliku requirements.txt.</p>
                    <div className="bg-black/50 p-3 rounded-lg border border-white/5 font-mono text-sm text-emerald-400">
                      pip install -r requirements.txt
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="bg-[#151515] border border-white/5 rounded-2xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                    <h3 className="text-lg font-medium text-white mb-3 flex items-center gap-2">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-500 text-xs font-bold">3</span>
                      Uruchomienie lokalne
                    </h3>
                    <p className="text-gray-400 text-sm mb-4">Uruchom główny skrypt bota. Przy pierwszym uruchomieniu Telegram poprosi o kod weryfikacyjny.</p>
                    <div className="bg-black/50 p-3 rounded-lg border border-white/5 font-mono text-sm text-emerald-400 mb-4">
                      python main.py
                    </div>
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-start gap-3">
                      <BookOpen size={18} className="text-blue-500 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-medium text-blue-400 mb-1">Struktura katalogów</h4>
                        <p className="text-xs text-blue-400/80 leading-relaxed">
                          Bot automatycznie utworzy folder <code>accounts/</code> na plik sesji oraz folder <code>logs/</code> na pliki z logami działania.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Step 4 - Railway */}
                  <div className="bg-[#151515] border border-white/5 rounded-2xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
                    <h3 className="text-lg font-medium text-white mb-3 flex items-center gap-2">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-500/20 text-purple-500 text-xs font-bold">4</span>
                      Hosting 24/7 (Railway.app)
                    </h3>
                    <div className="space-y-4 text-sm text-gray-400">
                      <p>Aby bot działał 24/7 bez włączonego komputera:</p>
                      <ol className="list-decimal list-inside space-y-2 ml-2">
                        <li>Stwórz repozytorium na GitHub i wrzuć tam wszystkie pliki (oprócz <code>.env</code>).</li>
                        <li>Połącz repozytorium z <b>Railway.app</b>. Railway automatycznie wykryje <code>Dockerfile</code>.</li>
                        <li>W zakładce <b>Variables</b> na Railway dodaj wszystkie zmienne z pliku <code>.env</code>.</li>
                        <li><b>Logowanie:</b> Jeśli bot poprosi o kod, otwórz zakładkę <b>Terminal</b> w panelu Railway i wpisz go tam.</li>
                        <li><b>Sesja:</b> Aby uniknąć wylogowania, dodaj <b>Volume</b> w Railway zamontowany do ścieżki <code>/app/sessions</code>.</li>
                      </ol>
                      <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 flex items-start gap-3 mt-4">
                        <Terminal size={18} className="text-purple-500 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-sm font-medium text-purple-400 mb-1">Docker & Railway.json</h4>
                          <p className="text-xs text-purple-400/80 leading-relaxed">
                            Używamy <code>Dockerfile</code> dla maksymalnej kontroli nad środowiskiem (instalacja <code>cryptg</code> dla szybkości). Plik <code>railway.json</code> zapewnia automatyczny restart przy błędach.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* NAMES DATABASE TAB */}
            {activeTab === 'names' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div>
                  <h2 className="text-2xl font-semibold text-white mb-2">Baza Nazw OG</h2>
                  <p className="text-gray-400 text-sm">Lista krótkich, pożądanych nazw użytkownika (3-4 litery). Skopiuj i wklej do konfiguratora.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* English OG */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-medium text-emerald-400">Angielskie OG (500+)</h3>
                      <button 
                        onClick={() => copyToClipboard(ENGLISH_OG.join(', '))}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-md text-xs font-medium transition-colors"
                      >
                        <Copy size={14} /> Kopiuj wszystkie
                      </button>
                    </div>
                    <div className="bg-[#151515] border border-white/10 rounded-xl p-4 h-[500px] overflow-y-auto">
                      <div className="flex flex-wrap gap-2">
                        {ENGLISH_OG.map(name => (
                          <span key={name} className="px-2 py-1 bg-white/5 rounded text-xs font-mono text-gray-300 hover:bg-emerald-500/20 hover:text-emerald-400 cursor-pointer transition-colors">
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Polish OG */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-medium text-blue-400">Polskie OG (500+)</h3>
                      <button 
                        onClick={() => copyToClipboard(POLISH_OG.join(', '))}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-md text-xs font-medium transition-colors"
                      >
                        <Copy size={14} /> Kopiuj wszystkie
                      </button>
                    </div>
                    <div className="bg-[#151515] border border-white/10 rounded-xl p-4 h-[500px] overflow-y-auto">
                      <div className="flex flex-wrap gap-2">
                        {POLISH_OG.map(name => (
                          <span key={name} className="px-2 py-1 bg-white/5 rounded text-xs font-mono text-gray-300 hover:bg-blue-500/20 hover:text-blue-400 cursor-pointer transition-colors">
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Name Generator Section */}
                <div className="bg-[#151515] border border-emerald-500/20 rounded-2xl p-8 shadow-xl mt-8">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-500">
                      <Zap size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-white">Generator Nazw Losowych</h3>
                      <p className="text-gray-400 text-sm">Stwórz własne kombinacje liter do monitorowania.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">Kategoria</label>
                      <select 
                        value={genCategory}
                        onChange={(e) => setGenCategory(e.target.value)}
                        className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-all"
                      >
                        {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">Długość nazwy</label>
                      <input 
                        type="number"
                        min="1"
                        max="10"
                        value={genLength}
                        onChange={(e) => setGenLength(parseInt(e.target.value))}
                        className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">Ilość nazw</label>
                      <select 
                        value={genCount}
                        onChange={(e) => setGenCount(parseInt(e.target.value))}
                        className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-all"
                      >
                        {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n} sztuk</option>)}
                      </select>
                    </div>
                    <button 
                      onClick={generateRandomNames}
                      disabled={isGenerating}
                      className="bg-emerald-500 hover:bg-emerald-600 text-black font-bold py-3 px-6 rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGenerating ? 'Generowanie...' : 'Generuj i dodaj'}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-4 italic">
                    * Wygenerowane nazwy zostaną automatycznie dopisane do Twojej listy w konfiguratorze.
                  </p>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
