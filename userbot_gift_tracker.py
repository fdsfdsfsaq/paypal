from telethon import TelegramClient, events
import requests
import os
import re

# Примерные настройки
api_id = os.getenv('API_ID')
api_hash = os.getenv('API_HASH')
phone = '+48 577 086 767' # Номер телефона аккаунта @GIFTBOTRELAYER

# Подключение к БД
import mysql.connector
db = mysql.connector.connect(
    host="ваш_хост_timeweb",
    user="ваш_пользователь",
    password="ваш_пароль",
    database="ваша_бд"
)
cursor = db.cursor()

from telethon import TelegramClient, events
import re

client = TelegramClient('giftbot_relayer_session', api_id, api_hash)

# ЗАДАЧА 1: Обработка ВНОСА подарков (игрок переслал подарок на @GIFTBOTRELAYER)
@client.on(events.NewMessage(incoming=True, pattern=re.compile(r'Подарок от', re.IGNORECASE)))
async def handler_new_deposit(event):
    # Проверяем, что сообщение переслано от нашего бота
    if event.message.fwd_from and event.message.fwd_from.from_id:
        # Парсим данные из текста сообщения
        text = event.message.text
        lines = text.split('\n')

        # Извлекаем данные с помощью re (упрощенно)
        gift_name_match = re.search(r'- (.*?) #(\d+)', lines[1])
        model_match = re.search(r'- (.*)', lines[2])
        background_match = re.search(r'- (.*)', lines[3])
        pattern_match = re.search(r'- (.*)', lines[4])

        if all([gift_name_match, model_match, background_match, pattern_match]):
            gift_name = gift_name_match.group(1).strip()
            gift_unique_id = gift_name_match.group(2).strip()
            gift_model = model_match.group(1).strip()
            gift_background = background_match.group(1).strip()
            gift_pattern = pattern_match.group(1).strip()

            # ID исходного отправителя (игрока) из пересланного сообщения
            user_id = event.message.fwd_from.from_id.user_id

            # Сохраняем в БД
            sql = """INSERT INTO gifts (user_id, gift_name, gift_unique_id, gift_model, gift_background, gift_pattern, status, message_id, chat_id)
                     VALUES (%s, %s, %s, %s, %s, %s, 'active', %s, %s)"""
            val = (user_id, gift_name, gift_unique_id, gift_model, gift_background, gift_pattern, event.message.id, event.chat_id)
            cursor.execute(sql, val)
            db.commit()
            print(f"Добавлен подарок {gift_name} #{gift_unique_id} от пользователя {user_id}")

# ЗАДАЧА 2: Обработка ВЫВОДА подарков (Вы вручную переслали подарок игроку)
@client.on(events.NewMessage(outgoing=True))
async def handler_withdraw_sent(event):
    # Если это пересланное сообщение и оно адресовано пользователю (а не в группу/канал)
    if event.message.fwd_from and isinstance(event.message.peer_id, PeerUser):
        # Получаем ID исходного сообщения, которое мы переслали
        original_message_id = event.message.fwd_from.channel_post or event.message.fwd_from.from_id
        original_chat_id = event.message.fwd_from.from_id  # Или другое поле, важно найти связь

        # Ищем этот подарок в БД по message_id и chat_id
        sql = "SELECT id, gift_name, gift_unique_id FROM gifts WHERE message_id = %s AND chat_id = %s AND status = 'withdraw_requested'"
        cursor.execute(sql, (original_message_id, original_chat_id))
        gift_to_withdraw = cursor.fetchone()

        if gift_to_withdraw:
            gift_db_id, gift_name, gift_id = gift_to_withdraw
            # УДАЛЯЕМ запись из БД, так как вывод выполнен!
            delete_sql = "DELETE FROM gifts WHERE id = %s"
            cursor.execute(delete_sql, (gift_db_id,))
            db.commit()
            print(f"Подарок {gift_name} #{gift_id} выведен и удален из БД!")
            # Или меняем статус: UPDATE gifts SET status='withdrawn' WHERE id=%s

# Запускаем клиента
with client:
    client.run_until_disconnected()