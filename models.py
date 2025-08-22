from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class User(db.Model):
    id = db.Column(db.BigInteger, primary_key=True)  # было Integer
    username = db.Column(db.String(64), nullable=False)
    avatar = db.Column(db.String(256))
    # Связь с инвентарём (подарки)
    inventory = db.relationship('Gift', backref='owner', lazy=True)
    # Связь с победами (история игр)
    wins = db.relationship('GameHistory', backref='winner', lazy=True)

    def as_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "avatar": self.avatar
        }

class Gift(db.Model):
    id = db.Column(db.String(64), primary_key=True)
    user_id = db.Column(db.BigInteger, db.ForeignKey('user.id'))  # Было Integer
    name = db.Column(db.String(128))
    img = db.Column(db.String(256))
    model = db.Column(db.String(64))
    background = db.Column(db.String(64))
    pattern = db.Column(db.String(64))
    status = db.Column(db.String(16), default='active') # active/in_game/withdrawn
    price = db.Column(db.Float, default=1.0)  # <--- добавлено

    def as_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "name": self.name,
            "img": self.img,
            "model": self.model,
            "background": self.background,
            "pattern": self.pattern,
            "status": self.status,
            "price": self.price  # <--- добавлено
        }

class GameHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime)
    bank = db.Column(db.Float)
    winner_id = db.Column(db.BigInteger, db.ForeignKey('user.id'))  # Было Integer
    gift_ids = db.Column(db.String(512)) # Список id подарков через запятую
    players_snapshot = db.Column(db.Text) # JSON-слепок игроков и ставок

    def as_dict(self):
        return {
            "id": self.id,
            "timestamp": self.timestamp.strftime("%Y-%m-%d %H:%M") if self.timestamp else None,
            "bank": self.bank,
            "winner_id": self.winner_id,
            "gift_ids": self.gift_ids,
            "players_snapshot": self.players_snapshot
        }