# Telegram Sniper Bot - Railway Deployment Guide

Ten projekt jest w pełni przygotowany do wdrożenia na platformie **Railway**.

## Kroki wdrożenia:

1. **Przygotuj repozytorium:**
   - Wrzuć kod na swoje repozytorium GitHub.

2. **Wdrożenie na Railway:**
   - Zaloguj się na [Railway.app](https://railway.app/).
   - Kliknij **"New Project"** -> **"Deploy from GitHub repo"**.
   - Wybierz swoje repozytorium.

3. **Konfiguracja Bazy Danych:**
   - W widoku projektu Railway kliknij **"Add Service"** -> **"Database"** -> **"Add PostgreSQL"**.
   - Railway automatycznie doda zmienną `DATABASE_URL` do Twojej aplikacji.

4. **Zmienne Środowiskowe:**
   - Przejdź do zakładki **Variables** w swojej aplikacji na Railway.
   - Dodaj następujące zmienne (możesz je też skonfigurować później w panelu bota):
     - `TELEGRAM_API_ID` (opcjonalnie)
     - `TELEGRAM_API_HASH` (opcjonalnie)
     - `TELEGRAM_BOT_TOKEN` (opcjonalnie - do powiadomień)
     - `TELEGRAM_CHAT_ID` (opcjonalnie - do powiadomień)

5. **Uruchomienie:**
   - Railway automatycznie wykryje `package.json`, zainstaluje zależności, zbuduje frontend (`npm run build`) i uruchomi serwer (`npm start`).
   - Aplikacja będzie dostępna pod adresem wygenerowanym przez Railway (zakładka **Settings** -> **Public Networking** -> **Generate Domain**).

## Funkcje Railway:
- **Automatyczny HTTPS:** Railway zapewnia certyfikat SSL.
- **PostgreSQL:** Dane bota (konfiguracja, statystyki) są bezpiecznie przechowywane w chmurze.
- **Skalowalność:** Bot działa 24/7 bez Twojego udziału.

## Uwaga:
Pamiętaj, aby w panelu bota (Konfigurator) wygenerować i zapisać `StringSession`, aby bot mógł działać w tle po zamknięciu przeglądarki.
