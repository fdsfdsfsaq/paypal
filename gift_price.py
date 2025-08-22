import json

with open("gift_prices.json") as f:
    PRICE_MAP = json.load(f)

def get_gift_price(gift_name):
    # Если в названии есть "#", берем только тип
    base_name = gift_name.split("#")[0].strip()
    return PRICE_MAP.get(base_name, 1.0)