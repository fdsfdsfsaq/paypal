from dotenv import load_dotenv
import os
import requests
import base64

load_dotenv()

TONAPI_KEY = os.getenv('TONAPI_KEY')  # <-- Вставь свой ключ!

def is_ton_address_equal(addr1, addr2):
    if addr1 == addr2:
        return True
    try:
        pad = lambda s: s + '=' * (-len(s) % 4)
        b1 = base64.urlsafe_b64decode(pad(addr1))
        b2 = base64.urlsafe_b64decode(pad(addr2))
        return b1 == b2
    except Exception:
        return False

def check_incoming_payment(address, expected_amount, user_address):
    url = f"https://tonapi.io/v2/blockchain/accounts/{address}/transactions"
    params = {"limit": 30}
    headers = {
        "Authorization": f"Bearer {TONAPI_KEY}"
    }
    resp = requests.get(url, params=params, headers=headers)
    if not resp.ok:
        print("Ошибка tonapi:", resp.text)
        return False
    txs = resp.json().get("transactions", [])
    print("user_wallet_address (frontend):", user_address)
    print("Всего входящих транзакций:", len(txs))
    for tx in txs:
        inmsg = tx.get("in_msg")
        print("TX hash:", tx.get("hash"))
        if inmsg:
            source = inmsg.get("source")
            # Исправление! Если source — dict, то берем address
            if isinstance(source, dict):
                source_addr = source.get("address")
            else:
                source_addr = source
            print("   inmsg['source']:", source_addr)
            print("   value:", int(inmsg.get("value", 0)) / 1e9)
            print("   сравнение:", is_ton_address_equal(source_addr, user_address))
            if is_ton_address_equal(source_addr, user_address):
                value = int(inmsg.get("value", 0)) / 1e9
                if value >= expected_amount:
                    print("TON найден! Hash:", tx.get("hash"))
                    return tx.get("hash")
    print("TON не найден. Лог адреса:", user_address)
    return False