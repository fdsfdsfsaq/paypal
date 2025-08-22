import asyncio
from aiogram import Bot, Dispatcher, types, F
from aiogram.types import LabeledPrice, PreCheckoutQuery
from aiogram.filters import Command

TOKEN = "8351183982:AAENyJN--4aXZPtbLyGoez2KEyTItg0cNUg"
bot = Bot(token=TOKEN)
dp = Dispatcher()

# --- Команда /start ---
@dp.message(Command("start"))
async def start(message: types.Message):
    await message.answer("Привет! Хочешь купить 10 Stars? Жми /buy")

# --- Создаём invoice ---
@dp.message(Command("buy"))
async def buy_stars(message: types.Message):
    prices = [LabeledPrice(label="10 Stars", amount=10_000_000)]  # 10 Stars
    await bot.send_invoice(
        chat_id=message.chat.id,
        title="Покупка Stars",
        description="Покупка 10 Stars для твоего аккаунта",
        payload="stars_order_10",
        provider_token="stars",
        currency="XTR",
        prices=prices,
        start_parameter="stars-payment"
    )

# --- PreCheckoutQuery ---
@dp.pre_checkout_query()
async def pre_checkout_query(pre_checkout_q: PreCheckoutQuery):
    await bot.answer_pre_checkout_query(pre_checkout_q.id, ok=True)

# --- Успешная оплата ---
@dp.message(F.successful_payment)
async def successful_payment(message: types.Message):
    payment_info = message.successful_payment
    stars_paid = payment_info.total_amount // 1_000_000
    await message.answer(f"✅ Оплата прошла!\nТы заплатил {stars_paid} Stars.")

async def main():
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
