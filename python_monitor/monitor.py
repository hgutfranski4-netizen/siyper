import time
import sqlite3
import logging
import telebot
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Config - Replace with your actual values
TELEGRAM_BOT_TOKEN = "YOUR_TOKEN"
TELEGRAM_CHAT_ID = "YOUR_CHAT_ID"
CHECK_INTERVAL = 60  # seconds
MIN_LENGTH = 3
MAX_PRICE = 50  # TON
MAX_TIME_HOURS = 24

# Setup
logging.basicConfig(level=logging.INFO)
bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)
conn = sqlite3.connect('fragment_monitor.db')
cursor = conn.cursor()
cursor.execute('CREATE TABLE IF NOT EXISTS seen_usernames (username TEXT PRIMARY KEY)')
conn.commit()

def scrape_fragment():
    options = uc.ChromeOptions()
    options.add_argument('--headless')
    driver = uc.Chrome(options=options)
    try:
        driver.get("https://fragment.com/usernames")
        # Wait for the list to load
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CLASS_NAME, "tm-row-selectable"))
        )
        
        # This is a simplified example, you'll need to adjust selectors based on actual Fragment HTML
        items = driver.find_elements(By.CLASS_NAME, "tm-row-selectable")
        results = []
        for item in items:
            # Extract data here
            # username = item.find_element(By.CLASS_NAME, "tm-value").text
            # ...
            pass
        return results
    except Exception as e:
        logging.error(f"Error scraping: {e}")
        return []
    finally:
        driver.quit()

def monitor():
    logging.info("Starting monitoring...")
    while True:
        usernames = scrape_fragment()
        for u in usernames:
            # Check if seen
            cursor.execute('SELECT 1 FROM seen_usernames WHERE username = ?', (u['username'],))
            if cursor.fetchone():
                continue
            
            # Check conditions
            if len(u['username']) <= MIN_LENGTH and u['price'] <= MAX_PRICE:
                # Send Alert
                msg = f"🔥 *Okazja!* @{u['username']}\nCena: {u['price']} TON\nCzas: {u['time']}\n[Link](https://fragment.com/username/{u['username']})"
                bot.send_message(TELEGRAM_CHAT_ID, msg, parse_mode='Markdown')
                
                # Mark as seen
                cursor.execute('INSERT INTO seen_usernames (username) VALUES (?)', (u['username'],))
                conn.commit()
        
        time.sleep(CHECK_INTERVAL)

if __name__ == "__main__":
    monitor()
