from telethon import TelegramClient, events
import requests
import os
import re

api_id = os.getenv('API_ID')  # <-- твой api_id
api_hash = os.getenv('API_HASH')  # <-- твой api_hash
phone = '+48 577 086 767'  # <-- твой номер

BACKEND_API = "https://paypal.net.ru/api/deposit_gift"
MEDIA_SAVE_PATH = 'media/'

client = TelegramClient('session_userbot', api_id, api_hash)

def parse_gift_caption(text):
    # Пример caption:
    # "Сохранённый подарок\nWinter Wreath #14182\nМодель Barbie Core\nФон Copper\nУзор Candy"
    lines = text.split('\n')
    gift_info = {}
    # Поиск основной строки с названием и номером
    match = re.search(r'(.+?)\s*#(\d+)', text)
    if match:
        gift_info['name'] = match.group(1).strip()
        gift_info['number'] = match.group(2)
    else:
        gift_info['name'] = "Unknown Gift"
        gift_info['number'] = "0"
    # Дополнительные параметры
    for line in lines:
        if line.startswith('Модель'):
            gift_info['model'] = line.replace('Модель', '').strip()
        if line.startswith('Фон'):
            gift_info['background'] = line.replace('Фон', '').strip()
        if line.startswith('Узор'):
            gift_info['pattern'] = line.replace('Узор', '').strip()
    return gift_info

@client.on(events.NewMessage(incoming=True))
async def handler(event):
    sender = await event.get_sender()
    user_id = sender.id
    username = sender.username or f"id{user_id}"

    # Проверяем, что есть медиа и подпись с нужной фразой
    if event.media and event.text and "Сохранённый подарок" in event.text:
        # Парсим инфу о подарке
        gift_info = parse_gift_caption(event.text)
        if not os.path.exists(MEDIA_SAVE_PATH):
            os.makedirs(MEDIA_SAVE_PATH)
        file_path = await event.download_media(file=MEDIA_SAVE_PATH)
        # Загружаем на telegra.ph
        with open(file_path, 'rb') as f:
            resp = requests.post('https://telegra.ph/upload', files={'file': f})
        if resp.ok and resp.json():
            img_url = 'https://telegra.ph' + resp.json()[0]['src']
        else:
            img_url = "https://ui-avatars.com/api/?name=Gift"
        gift = {
            "id": f"gift_{user_id}_{event.id}",
            "name": f"{gift_info.get('name', 'NFT Gift')} #{gift_info.get('number','')}",
            "img": img_url,
            "model": gift_info.get('model',''),
            "background": gift_info.get('background',''),
            "pattern": gift_info.get('pattern','')
        }
        payload = {
            "user_id": user_id,
            "username": username,
            "gift": gift
        }
        requests.post(BACKEND_API, json=payload)
        print(f"NFT-подарок @{username} ({user_id}) добавлен! {img_url} - {gift['name']}")

client.start(phone)
client.run_until_disconnected()