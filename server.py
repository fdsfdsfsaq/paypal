from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from models import db, User, Gift, GameHistory
from flask_migrate import Migrate
from gift_price import get_gift_price
from ton_chek import check_incoming_payment
from dotenv import load_dotenv
import os
import random
import math
from datetime import datetime
import time
import threading
import json

app = Flask(__name__, static_folder='static')

load_dotenv()

# --- MySQL connection example ---
app.config["SQLALCHEMY_DATABASE_URI"] = f"mysql+pymysql://{os.getenv('MYSQL_USER')}:{os.getenv('MYSQL_PASSWORD')}@{os.getenv('MYSQL_HOST')}:{os.getenv('MYSQL_PORT')}/{os.getenv('MYSQL_DB')}?charset=utf8mb4"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)
migrate = Migrate(app, db)
CORS(app)

CURRENT_BEE_ROUND = {
    "players": [],
    "bank": 0,
    "gifts": [],
    "phase": "waiting",
    "winner": None,
    "start_time": None,
    "winner_bee_index": None,  # индекс выбранной пчелы
    "spin_start_time": None
}

CURRENT_ROUND = {
    "players": [],
    "bank": 0,
    "gifts": [],
    "phase": "waiting",
    "winner": None,
    "start_time": None,
    "winner_angle": None,
    "spin_start_time": None
}

SPIN_ANIMATION_DURATION = 3
COUNTDOWN_DURATION = 30
SHOW_WINNER_DURATION = 5
MIN_PLAYERS = 2

def get_user_or_create(user_id, username, avatar=None):
    user = User.query.get(user_id)
    if not user:
        user = User(id=user_id, username=username, avatar=avatar)
        db.session.add(user)
        db.session.commit()
    return user

@app.route('/api/inventory/<int:user_id>')
def get_inventory(user_id):
    gifts = Gift.query.filter_by(user_id=user_id, status='active').all()
    active_gifts = Gift.query.filter_by(user_id=user_id, status='in_game').all()
    return jsonify({
        "inventory": [g.as_dict() for g in gifts],
        "active_gifts": [g.as_dict() for g in active_gifts]
    })

@app.route('/api/deposit_gift', methods=['POST'])
def deposit_gift():
    data = request.json
    user_id = data["user_id"]
    username = data["username"]
    gift = data["gift"]
    user = get_user_or_create(user_id, username)
    price = get_gift_price(gift["name"])
    g = Gift(
        id = gift["id"],
        user_id = user_id,
        name = gift["name"],
        img = gift["img"],
        model = gift.get("model"),
        background = gift.get("background"),
        pattern = gift.get("pattern"),
        status = "active",
        price = price
    )
    db.session.add(g)
    db.session.commit()
    return jsonify({"status": "ok"})

@app.route('/api/withdraw_gift', methods=['POST'])
def withdraw_gift():
    data = request.json
    user_id = data["user_id"]
    gift_id = data["gift_id"]
    gift = Gift.query.filter_by(id=gift_id, user_id=user_id).first()
    if not gift:
        return jsonify({"error": "Gift not found"}), 404
    gift.status = "withdrawn"
    db.session.commit()
    return jsonify({"status": "ok"})

def bee_weighted_choice(players):
    bees = []
    for idx, p in enumerate(players):
        bees.extend([(idx, p)] * len(p["gifts"]))
    return random.choice(bees) if bees else (None, None)

def bee_spin_internal():
    if not CURRENT_BEE_ROUND["players"]:
        return None
    winner_idx, winner_player = bee_weighted_choice(CURRENT_BEE_ROUND["players"])
    win_user = get_user_or_create(winner_player["user_id"], winner_player["username"])
    for g in CURRENT_BEE_ROUND["gifts"]:
        gift_row = Gift.query.filter_by(id=g["id"]).first()
        if gift_row:
            gift_row.status = "active"
            gift_row.user_id = win_user.id
    db.session.commit()
    for p in CURRENT_BEE_ROUND["players"]:
        for g in p["gifts"]:
            gift_row = Gift.query.filter_by(id=g["id"]).first()
            if gift_row and gift_row.status == "in_game":
                gift_row.status = "active"
    db.session.commit()
    history = GameHistory(
        timestamp=datetime.now(),
        bank=0,
        winner_id=win_user.id,
        gift_ids=",".join([g["id"] for g in CURRENT_BEE_ROUND["gifts"]]),
        players_snapshot=json.dumps(CURRENT_BEE_ROUND["players"])
        # Можно добавить mode='bee' если добавишь поле в модель
    )
    db.session.add(history)
    db.session.commit()
    CURRENT_BEE_ROUND["winner"] = {"username": win_user.username, "gifts": CURRENT_BEE_ROUND["gifts"]}
    CURRENT_BEE_ROUND["winner_bee_index"] = winner_idx
    return {
        "winner": win_user.username,
        "gifts": CURRENT_BEE_ROUND["gifts"],
        "bee_index": winner_idx
    }

@app.route('/api/bee_spin', methods=['POST'])
def bee_spin():
    if CURRENT_BEE_ROUND["phase"] != "spinning":
        return jsonify({"error": "Сейчас не время выбирать пчелу"})
    result = bee_spin_internal()
    CURRENT_BEE_ROUND["phase"] = "finished"
    CURRENT_BEE_ROUND["start_time"] = time.time()
    return jsonify(result)

@app.route('/api/debug_add_bees')
def debug_add_bees():
    CURRENT_BEE_ROUND["players"] = [
        {"user_id": 1, "username": "test1", "gifts": [
            {"id": "demo_1_123", "name": "Демо Пчела", "img": "/static/bee-avatar.svg", "model": "bee",
             "background": "#ffe14f", "pattern": "", "status": "in_game"}]},
        {"user_id": 2, "username": "test2", "gifts": [
            {"id": "demo_2_456", "name": "Демо Пчела", "img": "/static/bee-avatar.svg", "model": "bee",
             "background": "#ffe14f", "pattern": "", "status": "in_game"}]}
    ]
    CURRENT_BEE_ROUND["phase"] = "countdown"
    CURRENT_BEE_ROUND["start_time"] = time.time() + 30
    CURRENT_BEE_ROUND["winner"] = None
    CURRENT_BEE_ROUND["winner_bee_index"] = None
    return jsonify({"status": "ok"})

@app.route('/api/bee_round_state')
def bee_round_state():
    now = time.time()
    timer = 0
    phase = CURRENT_BEE_ROUND["phase"]

    # Переход countdown → spinning
    if phase == "countdown" and CURRENT_BEE_ROUND.get("start_time"):
        timer = int(max(0, CURRENT_BEE_ROUND["start_time"] - now))
        if timer <= 0:
            CURRENT_BEE_ROUND["phase"] = "spinning"
            CURRENT_BEE_ROUND["spin_start_time"] = now
            bee_spin_internal()
            phase = "spinning"
            timer = 3  # 3 секунды для анимации

    # Переход spinning → finished
    if phase == "spinning" and CURRENT_BEE_ROUND.get("spin_start_time"):
        spin_elapsed = now - CURRENT_BEE_ROUND["spin_start_time"]
        spin_timer = int(max(0, 3 - spin_elapsed))
        timer = spin_timer
        if spin_timer <= 0:
            CURRENT_BEE_ROUND["phase"] = "finished"
            CURRENT_BEE_ROUND["start_time"] = now
            phase = "finished"
            timer = 5  # 5 секунд для показа победителя

    # Показываем победителя 5 сек, потом сбрасываем раунд
    SHOW_WINNER_DURATION_BEE = 5
    if phase == "finished" and CURRENT_BEE_ROUND.get("start_time"):
        show_winner_elapsed = now - CURRENT_BEE_ROUND["start_time"]
        timer = int(max(0, SHOW_WINNER_DURATION_BEE - show_winner_elapsed))
        if show_winner_elapsed > SHOW_WINNER_DURATION_BEE:
            CURRENT_BEE_ROUND.update({
                "players": [],
                "bank": 0,
                "gifts": [],
                "phase": "waiting",
                "winner": None,
                "start_time": None,
                "winner_bee_index": None,
                "spin_start_time": None
            })
            phase = "waiting"
            timer = 0

    resp = {
        "players": CURRENT_BEE_ROUND["players"],
        "gifts": CURRENT_BEE_ROUND["gifts"],
        "phase": phase,
        "winner": CURRENT_BEE_ROUND["winner"],
        "winner_bee_index": CURRENT_BEE_ROUND["winner_bee_index"],
        "timer": timer,
        "start_time": CURRENT_BEE_ROUND.get("start_time"),
    }
    return jsonify(resp)

# --- Фоновый polling для bee_round_state ---
def bee_round_phase_loop():
    while True:
        with app.app_context():
            bee_round_state()
        time.sleep(1)

threading.Thread(target=bee_round_phase_loop, daemon=True).start()

@app.route('/api/bee_start_round', methods=['POST'])
def bee_start_round():
    CURRENT_BEE_ROUND.update({
        "players": [],
        "bank": 0,
        "gifts": [],
        "phase": "waiting",
        "winner": None,
        "start_time": None,
        "winner_bee_index": None,
        "spin_start_time": None
    })
    return jsonify({"status": "ok"})

@app.route('/api/bee_join_round', methods=['POST'])
def bee_join_round():
    print("bee_join_round CALLED!", request.json)
    data = request.json
    user_id = data["user_id"]
    username = data["username"]
    bet_ton = float(data.get("bet_ton", 0))  # <- добавь это
    gifts_ids = data.get("gifts", [])
    user_wallet_address = data.get("user_wallet_address", "")

    # --- если это ставка TON (не просто gifts) ---
    if bet_ton > 0:
        if user_wallet_address != "demo_bee_wallet":
            deposit_address = "UQAq3oyvpiAsimXijqmINv13b_zYcwZdebHZ20yVd4Agmgpc"
            print("Пробуем проверить TON (bee), адрес юзера:", user_wallet_address, "Сумма:", bet_ton)
            payment = check_incoming_payment(deposit_address, bet_ton, user_wallet_address)
            if not payment:
                return jsonify({"status": "error", "reason": "TON не поступил"}), 400

    user = get_user_or_create(user_id, username)
    gifts = []
    # Обычные gifts
    for gid in gifts_ids:
        gift = Gift.query.filter_by(id=gid, user_id=user_id, status='active').first()
        if gift:
            gift.status = 'in_game'
            gifts.append(gift.as_dict())
    db.session.commit()

    active_gifts = gifts
    existing_player = next((p for p in CURRENT_BEE_ROUND["players"] if p["user_id"] == user_id), None)
    if existing_player:
        if "gifts" not in existing_player or not isinstance(existing_player["gifts"], list):
            existing_player["gifts"] = []
        existing_player["gifts"].extend(active_gifts)
        # Добавь обработку TON:
        existing_player["bet_ton"] = existing_player.get("bet_ton", 0) + bet_ton
    else:
        CURRENT_BEE_ROUND["players"].append({
            "user_id": user_id,
            "username": username,
            "gifts": active_gifts,
            "bet_ton": bet_ton  # добавь это поле
        })
    CURRENT_BEE_ROUND["gifts"].extend(active_gifts)
    if CURRENT_BEE_ROUND["phase"] == "waiting" and len(CURRENT_BEE_ROUND["players"]) >= 2:
        CURRENT_BEE_ROUND["phase"] = "countdown"
        CURRENT_BEE_ROUND["start_time"] = time.time() + 30
        CURRENT_BEE_ROUND["winner"] = None
        CURRENT_BEE_ROUND["winner_bee_index"] = None
    return jsonify({"status": "ok", "players": CURRENT_BEE_ROUND["players"]})

@app.route('/api/start_round', methods=['POST'])
def start_round():
    CURRENT_ROUND.update({
        "players": [],
        "bank": 0,
        "gifts": [],
        "phase": "waiting",
        "winner": None,
        "start_time": None,
        "winner_angle": None,
        "spin_start_time": None
    })
    return jsonify({"status": "ok"})

BEE_ROUND = {
    "players": [],
    "status": "waiting",
    # другие поля, если надо
}

@app.route('/api/join_round', methods=['POST'])
def join_round():
    data = request.json
    user_id = data["user_id"]
    username = data["username"]
    bet_ton = float(data.get("bet_ton", 0))  # TON, который игрок указал вручную
    gifts_ids = data.get("gifts", [])
    user_wallet_address = data.get("user_wallet_address", "")
    print("user_wallet_address (backend):", user_wallet_address)

    # --- если это ставка TON (не просто gifts) ---
    if bet_ton > 0:
        if user_wallet_address != "demo_bee_wallet":
            deposit_address = "UQAq3oyvpiAsimXijqmINv13b_zYcwZdebHZ20yVd4Agmgpc"
            print("Пробуем проверить TON, адрес юзера:", user_wallet_address, "Сумма:", bet_ton)
            payment = check_incoming_payment(deposit_address, bet_ton, user_wallet_address)
            if not payment:
                return jsonify({"status": "error", "reason": "TON не поступил"}), 400

    user = get_user_or_create(user_id, username)
    gifts = []
    gifts_price_sum = 0
    for gid in gifts_ids:
        gift = Gift.query.filter_by(id=gid, user_id=user_id, status='active').first()
        if gift:
            gift.status = 'in_game'
            gifts.append(gift)
            gifts_price_sum += float(getattr(gift, "price", 1.0))  # если price нет, пусть будет 1 TON

    db.session.commit()
    active_gifts = [g.as_dict() for g in gifts]

    # Суммарная ставка
    total_bet = bet_ton + gifts_price_sum

    existing_player = next((p for p in CURRENT_ROUND["players"] if p["user_id"] == user_id), None)
    if existing_player:
        existing_player["bet_ton"] += bet_ton
        existing_player["gift_bet"] += gifts_price_sum
        existing_player["gifts"].extend(active_gifts)
    else:
        CURRENT_ROUND["players"].append({
            "user_id": user_id,
            "username": username,
            "bet_ton": bet_ton,
            "gift_bet": gifts_price_sum,
            "gifts": active_gifts,
        })
    CURRENT_ROUND["bank"] += total_bet
    CURRENT_ROUND["gifts"].extend(active_gifts)
    if CURRENT_ROUND["phase"] == "waiting" and len(CURRENT_ROUND["players"]) >= MIN_PLAYERS:
        CURRENT_ROUND["phase"] = "countdown"
        CURRENT_ROUND["start_time"] = time.time() + COUNTDOWN_DURATION
        CURRENT_ROUND["winner"] = None
        CURRENT_ROUND["winner_angle"] = None
    return jsonify({"status": "ok", "players": CURRENT_ROUND["players"]})

def weighted_choice(players):
    tickets = []
    for p in players:
        weight = max(1, int(p["bet_ton"]) + len(p["gifts"]))
        tickets.extend([p] * weight)
    return random.choice(tickets) if tickets else None

def spin_wheel_internal():
    if not CURRENT_ROUND["players"]:
        return None
    winner = weighted_choice(CURRENT_ROUND["players"])
    weights = [max(1, int(p["bet_ton"]) + len(p["gifts"])) for p in CURRENT_ROUND["players"]]
    total_weight = sum(weights)
    angles = []
    angle_sum = 0
    for w in weights:
        angle = (w / total_weight) * 2 * math.pi
        angles.append((angle_sum, angle_sum + angle))
        angle_sum += angle
    winner_index = CURRENT_ROUND["players"].index(winner)
    winner_angle_range = angles[winner_index]
    winner_angle = random.uniform(winner_angle_range[0], winner_angle_range[1])
    win_user = get_user_or_create(winner["user_id"], winner["username"])
    for g in CURRENT_ROUND["gifts"]:
        gift_row = Gift.query.filter_by(id=g["id"]).first()
        if gift_row:
            gift_row.status = "active"
            gift_row.user_id = win_user.id
    db.session.commit()
    for p in CURRENT_ROUND["players"]:
        for g in p["gifts"]:
            gift_row = Gift.query.filter_by(id=g["id"]).first()
            if gift_row and gift_row.status == "in_game":
                gift_row.status = "active"
    db.session.commit()
    history = GameHistory(
        timestamp=datetime.now(),
        bank=CURRENT_ROUND["bank"],
        winner_id=win_user.id,
        gift_ids=",".join([g["id"] for g in CURRENT_ROUND["gifts"]]),
        players_snapshot=json.dumps(CURRENT_ROUND["players"])
    )
    db.session.add(history)
    db.session.commit()
    CURRENT_ROUND["winner"] = {"username": win_user.username, "gifts": CURRENT_ROUND["gifts"]}
    CURRENT_ROUND["winner_angle"] = winner_angle
    return {
        "winner": win_user.username,
        "amount": CURRENT_ROUND["bank"],
        "gifts": CURRENT_ROUND["gifts"],
        "angle": winner_angle
    }

@app.route('/api/spin_wheel', methods=['POST'])
def spin_wheel():
    if CURRENT_ROUND["phase"] != "spinning":
        return jsonify({"error": "Сейчас не время крутить колесо"})
    result = {
        "winner": CURRENT_ROUND["winner"],
        "amount": CURRENT_ROUND["bank"],
        "gifts": CURRENT_ROUND["gifts"],
        "angle": CURRENT_ROUND["winner_angle"]
    }
    CURRENT_ROUND["phase"] = "finished"
    CURRENT_ROUND["start_time"] = time.time()
    return jsonify(result)

LAST_WINNER_CLEAN_TIME = None
CLEAN_WINNER_DELAY = 10  # сколько секунд хранить winner после сброса раунда

@app.route('/api/round_state')
def round_state():
    global LAST_WINNER_CLEAN_TIME
    now = time.time()
    timer = 0
    phase = CURRENT_ROUND["phase"]
    if phase == "countdown" and CURRENT_ROUND.get("start_time"):
        timer = int(max(0, CURRENT_ROUND["start_time"] - now))
        if timer <= 0:
            CURRENT_ROUND["phase"] = "spinning"
            CURRENT_ROUND["spin_start_time"] = now
            spin_wheel_internal()
            phase = CURRENT_ROUND["phase"]
    if phase == "spinning":
        spin_elapsed = now - CURRENT_ROUND.get("spin_start_time", now)
        spin_timer = int(max(0, SPIN_ANIMATION_DURATION - spin_elapsed))
        timer = spin_timer
        if spin_timer <= 0:
            CURRENT_ROUND["phase"] = "finished"
            CURRENT_ROUND["start_time"] = now
            phase = CURRENT_ROUND["phase"]
    if phase == "finished" and CURRENT_ROUND.get("start_time"):
        show_winner_elapsed = now - CURRENT_ROUND["start_time"]
        timer = int(max(0, SHOW_WINNER_DURATION - show_winner_elapsed))
        if show_winner_elapsed > SHOW_WINNER_DURATION:
            CURRENT_ROUND.update({
                "phase": "waiting",
                "players": [],
                "bank": 0,
                "gifts": [],
                "start_time": None,
                "spin_start_time": None
            })
            phase = CURRENT_ROUND["phase"]
            LAST_WINNER_CLEAN_TIME = now  # запомни время перехода
    if phase == "waiting" and CURRENT_ROUND.get("winner") and LAST_WINNER_CLEAN_TIME:
        if now - LAST_WINNER_CLEAN_TIME > CLEAN_WINNER_DELAY:
            CURRENT_ROUND["winner"] = None
            CURRENT_ROUND["winner_angle"] = None
            LAST_WINNER_CLEAN_TIME = None

    resp = {
        "players": CURRENT_ROUND["players"],
        "bank": CURRENT_ROUND["bank"],
        "gifts": CURRENT_ROUND["gifts"],
        "phase": phase,
        "winner": CURRENT_ROUND["winner"],
        "winner_angle": CURRENT_ROUND["winner_angle"],
        "timer": timer,
        "start_time": CURRENT_ROUND.get("start_time"),
    }
    return jsonify(resp)

@app.route('/api/profile/<int:user_id>')
def profile(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"username": "demo", "avatar": None, "earn": 0, "withdraw_history": []})
    wins = GameHistory.query.filter_by(winner_id=user_id).all()
    total_earn = sum([w.bank for w in wins])
    withdraw_history = []
    for w in wins:
        gifts = [Gift.query.get(gid).as_dict() for gid in w.gift_ids.split(",") if Gift.query.get(gid)]
        withdraw_history.append({
            "date": w.timestamp.strftime("%Y-%m-%d %H:%M"),
            "gifts": gifts
        })
    return jsonify({
        "username": user.username,
        "avatar": user.avatar,
        "earn": total_earn,
        "withdraw_history": withdraw_history
    })

@app.route('/api/round_history')
def round_history():
    try:
        limit = int(request.args.get('limit', 30))
    except:
        limit = 30

    rounds = GameHistory.query.order_by(GameHistory.timestamp.desc()).limit(limit).all()
    history = []
    for r in rounds:
        user = User.query.get(r.winner_id)
        username = user.username if user else "–"
        avatar = user.avatar if user and user.avatar else f"https://ui-avatars.com/api/?name={username}"

        date = r.timestamp.strftime("%d.%m") if r.timestamp else ""
        time = r.timestamp.strftime("%H:%M") if r.timestamp else ""

        amount = round(r.bank or 0, 2)

        chance = 0
        try:
            players = json.loads(r.players_snapshot)
            winner_player = next((p for p in players if p["user_id"] == r.winner_id), None)
            all_weights = [max(1, int(p.get("bet_ton", 0)) + len(p.get("gifts", []))) for p in players]
            winner_weight = max(1, int(winner_player.get("bet_ton", 0)) + len(winner_player.get("gifts", []))) if winner_player else 1
            chance = round(100 * winner_weight / sum(all_weights), 2) if all_weights and sum(all_weights) > 0 else 0
        except Exception as e:
            chance = 0

        gifts = []
        for gid in (r.gift_ids or "").split(","):
            g = Gift.query.get(gid)
            if g:
                gifts.append({"name": g.name, "img": g.img})

        history.append({
            "id": r.id,
            "date": date,
            "time": time,
            "username": username,
            "avatar": avatar,
            "amount": amount,
            "chance": chance,
            "gifts": gifts
        })

    return jsonify({"history": history})

@app.route('/api/update_avatar', methods=['POST'])
def update_avatar():
    data = request.json
    user_id = data.get("user_id")
    avatar = data.get("avatar")
    user = User.query.get(user_id)
    if user and avatar:
        user.avatar = avatar
        db.session.commit()
        return jsonify({"status": "ok"})
    return jsonify({"status": "error"}), 400

@app.route('/api/info')
def api_info():
    online = User.query.count()
    max_win = GameHistory.query.order_by(GameHistory.bank.desc()).first()
    last_win = GameHistory.query.order_by(GameHistory.timestamp.desc()).first()

    def game_to_dict(win):
        if not win:
            return {
                "username": "–",
                "amount": "–",
                "gifts": [],
                "avatar": None,
                "date": "–"
            }
        user = User.query.get(win.winner_id) if win.winner_id else None
        gifts = []
        if win.gift_ids:
            gifts = [Gift.query.get(gid).as_dict() for gid in win.gift_ids.split(",") if Gift.query.get(gid)]
        avatar = None
        if user and user.avatar:
            avatar = user.avatar
        elif user and user.username:
            avatar = f"https://ui-avatars.com/api/?name={user.username}"
        else:
            avatar = None
        return {
            "username": user.username if user and user.username else "–",
            "amount": win.bank if hasattr(win, "bank") else "–",
            "gifts": gifts,
            "avatar": avatar,
            "date": win.timestamp.strftime("%Y-%m-%d %H:%M") if win.timestamp else "–"
        }

    return jsonify({
        "online": online,
        "max_win": game_to_dict(max_win),
        "last_win": game_to_dict(last_win)
    })

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/tonconnect-manifest.json')
def tonconnect_manifest():
    return send_from_directory(app.static_folder, 'tonconnect-manifest.json')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(app.static_folder, path)

def round_phase_loop():
    while True:
        with app.app_context():
            round_state()
        time.sleep(1)

threading.Thread(target=round_phase_loop, daemon=True).start()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

from flask.cli import with_appcontext
import click

@app.cli.command("create-db")
@with_appcontext
def create_db():
    db.create_all()
    print("База данных создана!")