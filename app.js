const API = "/api";

let bees = [];
let beeAnimationStarted = false; // Флаг, чтобы запускать анимацию только один раз
let beeWinnerShown = false;      // Флаг, чтобы показывать победителя только один раз
let LOCAL_ROUND_STATE = { players: [], bank: 0, gifts: [] };

const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
  manifestUrl: 'https://paypal.net.ru/tonconnect-manifest.json',
  buttonRootId: 'ton-connect-button'
});

let TG_USER_ID = window.TG_USER_ID || 1;
let TG_USERNAME = window.TG_USERNAME || "demo";
let TG_AVATAR = window.TG_AVATAR || "";

if (
  window.Telegram &&
  window.Telegram.WebApp &&
  window.Telegram.WebApp.initDataUnsafe &&
  window.Telegram.WebApp.initDataUnsafe.user
) {
  const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
  TG_USER_ID = tgUser.id;
  TG_USERNAME = tgUser.username || tgUser.first_name || "demo";
  TG_AVATAR = tgUser.photo_url || "";
}

let selectedGifts = [];
let timerInterval = null;
let roundData = null;
let wheelState = { players: [], rotation: 0 };
let infoBlockCache = {max_win:{},last_win:{}};
let lastWinnerShown = localStorage.getItem('lastWinnerShown') || '';
let lastRoundTime = localStorage.getItem('lastRoundTime') || null;
let isSpinning = false;
let beeSelectedGifts = [];
let beeRoundData = null;
let beeTimerInterval = null;
let beeWheelState = { bees: [], rotation: 0 };


function renderInfoCards(online, maxWin, lastWin) {
  const infoBlock = document.getElementById('info-block-cards');
  infoBlock.innerHTML = `
    <div class="info-card">
      <img class="info-avatar" src="${maxWin.avatar || maxWin.gifts[0]?.img || 'https://ui-avatars.com/api/?name='+(maxWin.username || 'user')}" />
      <div class="info-details">
        <div class="info-nick">@${maxWin.username || '–'}</div>
        <div class="info-ton">+${maxWin.amount || '–'} TON</div>
        <div class="info-subtitle">ТОП ИГРА</div>
        <div class="info-chance"></div>
      </div>
    </div>
    <div class="info-card">
      <img class="info-avatar" src="${lastWin.avatar || lastWin.gifts[0]?.img || 'https://ui-avatars.com/api/?name='+(lastWin.username || 'user')}" />
      <div class="info-details">
        <div class="info-nick">@${lastWin.username || '–'}</div>
        <div class="info-ton">+${lastWin.amount || '–'} TON</div>
        <div class="info-subtitle">ПРЕД. ИГРА</div>
        <div class="info-chance"></div>
      </div>
    </div>
    <div class="info-card">
      <div class="info-details">
        <div class="info-nick">Онлайн игроков:</div>
        <div class="info-ton">${online ?? '–'}</div>
        <div class="info-subtitle"></div>
        <div class="info-chance"></div>
      </div>
    </div>
  `;
}

function joinRound(userId, username, betTon, giftIds, userWalletAddress) {
  // 1. СРАЗУ показываем себя в списке (оптимистичный UI)
  const newPlayer = {
    user_id: userId,
    username: username,
    bet_ton: betTon,
    gift_bet: 0,
    gifts: []
  };

  LOCAL_ROUND_STATE.players.push(newPlayer);
  updatePlayersUI(LOCAL_ROUND_STATE.players);
  updateBankUI(LOCAL_ROUND_STATE.gifts, LOCAL_ROUND_STATE.bank);

  // 2. ПОКАЗЫВАЕМ ОБРАТНУЮ СВЯЗЬ ЗДЕСЬ! 🎉
  showSuccessFeedback();

  

  // 3. Возвращаем Promise из fetch
  return fetch(`${API}/join_round`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      user_id: userId,
      username: username,
      bet_ton: betTon,
      gifts: giftIds,
      user_wallet_address: userWalletAddress
    })
  })
  .then(res => res.json())
  .then(serverData => {
    if (serverData.status !== "ok") {
      LOCAL_ROUND_STATE.players = LOCAL_ROUND_STATE.players.filter(p => p.user_id !== userId);
      updatePlayersUI(LOCAL_ROUND_STATE.players);
      updateBankUI(LOCAL_ROUND_STATE.gifts, LOCAL_ROUND_STATE.bank);
      throw new Error(serverData.reason || "Ставка не принята");
    }
    return serverData;
  })

  .then(serverData => {
    if (serverData.status === "ok") {
      // Начисляем проценты рефереру
      addReferralEarnings(betTon);
    }
    return serverData;
  })
  .catch(error => {
    LOCAL_ROUND_STATE.players = LOCAL_ROUND_STATE.players.filter(p => p.user_id !== userId);
    updatePlayersUI(LOCAL_ROUND_STATE.players);
    updateBankUI(LOCAL_ROUND_STATE.gifts, LOCAL_ROUND_STATE.bank);
    throw error;
  });
}

function renderBeeInfoCards(online, maxWin, lastWin) {
  const infoBlock = document.getElementById('bee-info-block-cards');
  infoBlock.innerHTML = `
    <div class="info-card">
      <img class="info-avatar" src="${maxWin.avatar || maxWin.gifts[0]?.img || 'https://ui-avatars.com/api/?name='+(maxWin.username || 'user')}" />
      <div class="info-details">
        <div class="info-nick">@${maxWin.username || '–'}</div>
        <div class="info-ton">+${maxWin.amount || '–'} TON</div>
        <div class="info-subtitle">ТОП ИГРА</div>
      </div>
    </div>
    <div class="info-card">
      <img class="info-avatar" src="${lastWin.avatar || lastWin.gifts[0]?.img || 'https://ui-avatars.com/api/?name='+(lastWin.username || 'user')}" />
      <div class="info-details">
        <div class="info-nick">@${lastWin.username || '–'}</div>
        <div class="info-ton">+${lastWin.amount || '–'} TON</div>
        <div class="info-subtitle">ПРЕД. ИГРА</div>
      </div>
    </div>
    <div class="info-card">
      <div class="info-details">
        <div class="info-nick">Онлайн игроков:</div>
        <div class="info-ton">${online ?? '–'}</div>
      </div>
    </div>
  `;
}

// === Таймер ===
function startVisualTimer(sec, phase) {
  clearInterval(timerInterval);
  updateTimerText(sec, phase);
  timerInterval = setInterval(() => {
    if (sec > 0) {
      sec--;
      updateTimerText(sec, phase);
    } else {
      clearInterval(timerInterval);
    }
  }, 1000);
}

function updateTimerText(sec, phase) {
  const timerElem = document.getElementById('timer');
  if (phase === "waiting") {
    timerElem.innerText = "Ожидание игроков";
  } else if (phase === "countdown") {
    timerElem.innerText = `Старт через 00:${sec.toString().padStart(2, '0')}`;
  } else if (phase === "spinning") {
    timerElem.innerText = "Крутится...";
  } else if (phase === "finished") {
    timerElem.innerText = "";
  }
}

function fetchBeeInfoBlock() {
  fetch(`/api/info`).then(res => res.json()).then(data => {
    renderBeeInfoCards(data.online, data.max_win, data.last_win);
  });
}

function fetchBeeRoundState() {
  fetch('/api/bee_round_state').then(res => res.json()).then(data => {
    beeRoundData = data;
    fetchBeeInfoBlock();
    updateBeeBankUI(data.gifts);
    updateBeePlayersUI(data.players);

    // Таймер (аналогично PvP)
    if (data.phase === "waiting") {
      clearInterval(beeTimerInterval);
      updateBeeTimerText(0, "waiting");
      beeAnimationStarted = false;
      beeWinnerShown = false;
    } else if (data.phase === "countdown" && data.start_time) {
      const now = Date.now() / 1000;
      let secondsLeft = Math.max(0, Math.floor(data.start_time - now));
      startBeeVisualTimer(secondsLeft, "countdown");
      beeAnimationStarted = false;
      beeWinnerShown = false;
    } else if (data.phase === "spinning") {
      clearInterval(beeTimerInterval);
      updateBeeTimerText(0, "spinning");

      // Запускаем анимацию роя, если еще не запущено
      if (!beeAnimationStarted) {
        startBeeAnimation(data.players, data.winner_bee_index, () => {
          if (data.winner && !beeWinnerShown) {
            showBeeWinnerPopup(data.winner.username, data.winner.gifts || []);
            beeWinnerShown = true;
          }
        });
        beeAnimationStarted = true;
        beeWinnerShown = false;
      }
    } else if (data.phase === "finished") {
      clearInterval(beeTimerInterval);
      updateBeeTimerText(0, "finished");
      beeAnimationStarted = false;
      beeWinnerShown = false;
    }
    updateBeeBankUI(data.gifts);
    updateBeePlayersUI(data.players);
    document.getElementById('bee-winner').innerText = data.winner ? `Победитель: ${data.winner.username}` : "";
  }).catch(() => {
    clearInterval(beeTimerInterval);
    updateBeeTimerText(0, "waiting");
    beeAnimationStarted = false;
    beeWinnerShown = false;
  });
}


function startBeeVisualTimer(sec, phase) {
  clearInterval(beeTimerInterval);
  updateBeeTimerText(sec, phase);
  beeTimerInterval = setInterval(() => {
    if (sec > 0) {
      sec--;
      updateBeeTimerText(sec, phase);
    } else {
      clearInterval(beeTimerInterval);
    }
  }, 1000);
}

function updateBeeTimerText(sec, phase) {
  const timerElem = document.getElementById('bee-timer');
  if (phase === "waiting") {
    timerElem.innerText = "Ожидание игроков";
  } else if (phase === "countdown") {
    timerElem.innerText = `Старт через 00:${sec.toString().padStart(2, '0')}`;
  } else if (phase === "spinning") {
    timerElem.innerText = "Рой кружит...";
  } else if (phase === "finished") {
    timerElem.innerText = "";
  }
}

function startBeeAnimation(players, winnerBeeIndex, onWinnerArrived) {
  const canvas = document.getElementById('bee-canvas');
  const ctx = canvas.getContext('2d');
  let size = getMiniAppSize();
  canvas.width = size;
  canvas.height = size;

  const centerX = size / 2;
  const centerY = size / 2;
  const hiveRadius = size * 0.18;
  const beeFlyRadius = size * 0.34;
  const beeSize = size * 0.18;

  bees = [];
  players.forEach((p, idx) => {
    for (let i = 0; i < p.gifts.length; i++) {
      bees.push({
        avatarUrl: p.avatar || `https://ui-avatars.com/api/?name=${p.username}`,
        username: p.username,
        baseAngle: ((2 * Math.PI) / (players.length * p.gifts.length)) * (bees.length),
        angle: Math.random() * 2 * Math.PI,
        speed: Math.random() * 0.02 + 0.01,
        radius: beeFlyRadius,
        winner: false
      });
    }
  });
  let winnerArrived = false;
  if (winnerBeeIndex != null && bees[winnerBeeIndex]) {
    bees[winnerBeeIndex].winner = true;
  }

  function renderBees() {
    ctx.clearRect(0, 0, size, size);

    // рисуем улей
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.beginPath();
    ctx.arc(0, 0, hiveRadius, 0, 2 * Math.PI);
    ctx.fillStyle = "#ffe14f";
    ctx.fill();
    ctx.restore();

    // Анимация всех пчёл
    bees.forEach((bee, idx) => {
      if (bee.winner) {
        bee.radius -= 2;
        if (bee.radius <= hiveRadius && !winnerArrived) {
          bee.radius = hiveRadius;
          winnerArrived = true;
          if (onWinnerArrived) onWinnerArrived(); // Покажи победителя!
        }
      } else {
        bee.angle += bee.speed;
      }
      let x = centerX + bee.radius * Math.cos(bee.baseAngle + bee.angle);
      let y = centerY + bee.radius * Math.sin(bee.baseAngle + bee.angle);

      ctx.drawImage(beeImg, x - beeSize / 2, y - beeSize / 2, beeSize, beeSize);

      // Аватар
      const avatarImg = new Image();
      avatarImg.src = bee.avatarUrl;
      avatarImg.onload = () => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y + beeSize * 0.42, beeSize * 0.22, 0, 2 * Math.PI);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatarImg, x - beeSize * 0.22, y + beeSize * 0.2, beeSize * 0.44, beeSize * 0.44);
        ctx.restore();
      };
      if (avatarImg.complete) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y + beeSize * 0.42, beeSize * 0.22, 0, 2 * Math.PI);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatarImg, x - beeSize * 0.22, y + beeSize * 0.2, beeSize * 0.44, beeSize * 0.44);
        ctx.restore();
      }
    });

    if (!winnerArrived) requestAnimationFrame(renderBees);
    // Когда победная пчела в улье, анимация роя прекращается
  }
  renderBees();
}

const beeImg = new Image();
beeImg.src = '/static/bee-avatar.svg';

function beeJoinRound(userId, username, betTon, giftIds, userWalletAddress) {
  // Аналогично joinRound, но для bee раунда
  const newPlayer = {
    user_id: userId,
    username: username,
    bet_ton: betTon,
    gift_bet: 0,
    gifts: []
  };

  // Локальное обновление UI
  // ... ваш код для bee раунда

  // ПОКАЗЫВАЕМ ОБРАТНУЮ СВЯЗЬ И ЗДЕСЬ! 🐝
  showSuccessFeedback();

  fetch(`${API}/bee_join_round`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      user_id: userId,
      username: username,
      bet_ton: betTon,
      gifts: giftIds,
      user_wallet_address: userWalletAddress
    })
  })
  .then(res => res.json())
  .then(serverData => {
    if (serverData.status !== "ok") {
      // Обработка ошибки
      alert("Ошибка: " + (serverData.reason || "Ставка не принята"));
    }
    fetchBeeRoundState(); // Обновляем состояние
  })
  .catch(error => {
    console.error("Ошибка сети:", error);
  });
}

function drawBeeHive(players, rotation = 0, winnerBeeIndex = null) {
  bees = [];
  players.forEach((p, idx) => {
    let avatarUrl = p.avatar || `https://ui-avatars.com/api/?name=${p.username}`;
    for (let i = 0; i < p.gifts.length; i++) {
      bees.push({ avatarUrl, username: p.username, playerIdx: idx });
    }
  });
  // Пчела
  ctx.drawImage(beeImg, x - beeSize/2, y - beeSize/2, beeSize, beeSize);

  if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
  const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
  TG_USER_ID = tgUser.id;
  TG_USERNAME = tgUser.username || tgUser.first_name || "demo";
  TG_AVATAR = tgUser.photo_url || "";
  // --- отправляем на бэкенд для обновления avatar ---
  if (TG_AVATAR) {
    fetch(`/api/update_avatar`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({user_id: TG_USER_ID, avatar: TG_AVATAR})
    });
  }
}

  // Аватар игрока (внизу, под телом)
  const avatarImg = new Image();
  avatarImg.src = avatarUrl;
  avatarImg.onload = () => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y + beeSize * 0.42, beeSize * 0.22, 0, 2 * Math.PI); // круг как в SVG
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImg, x - beeSize * 0.22, y + beeSize * 0.2, beeSize * 0.44, beeSize * 0.44);
    ctx.restore();
  };
  if (avatarImg.complete) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y + beeSize * 0.42, beeSize * 0.22, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImg, x - beeSize * 0.22, y + beeSize * 0.2, beeSize * 0.44, beeSize * 0.44);
    ctx.restore();
  }
}

let hiveDoorY = 150;
let hiveDoorOpenY = 120;
let doorOpening = false;

function animateHiveDoor() {
  if (doorOpening && hiveDoorY > hiveDoorOpenY) {
    hiveDoorY -= 2; // скорость открытия (подбирай)
    if (hiveDoorY <= hiveDoorOpenY) {
      hiveDoorY = hiveDoorOpenY;
      doorOpening = false;
    }
  }
}

function drawHive(ctx) {
  // Рисуем корпус улья (можно drawImage или путь)
  // ctx.drawImage(hiveBodyImg, ...);

  // Дверца (ellipse)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(80, hiveDoorY, 18, 16, 0, 0, 2 * Math.PI);
  ctx.fillStyle = "#a37a31";
  ctx.strokeStyle = "#7d5b20";
  ctx.lineWidth = 4;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawHive(ctx);
  // ... другие элементы
  animateHiveDoor();
  requestAnimationFrame(render);
}

// Когда нужно открыть улей (например, при выборе победителя):
doorOpening = true;

function showBeeChooseGiftModal(gifts) {
  const modal = document.getElementById('choose-gift-modal');
  const list = document.getElementById('choose-gift-list');
  const confirmBtn = document.getElementById('chooseGiftConfirmBtn');
  let selectedGiftId = null;

  list.innerHTML = gifts.map(g =>
    `<div class="choose-gift-item" data-gift-id="${g.id}">
      <img src="${g.img}" alt="">
      <span>${g.name}</span>
    </div>`
  ).join('');

  confirmBtn.disabled = true;
  selectedGiftId = null;

  Array.from(list.children).forEach(el => {
    el.onclick = function() {
      Array.from(list.children).forEach(c => c.classList.remove("selected"));
      el.classList.add("selected");
      selectedGiftId = el.getAttribute("data-gift-id");
      confirmBtn.disabled = false;
    };
  });

  confirmBtn.onclick = function() {
    if (!selectedGiftId) return;
    fetch(`/api/bee_join_round`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        user_id: TG_USER_ID,
        username: TG_USERNAME,
        bet_ton: 0,
        gifts: [selectedGiftId]
      })
    }).then(() => {
      modal.style.display = "none";
      fetchBeeRoundState();
    });
  };

  document.getElementById('closeChooseGiftModal').onclick = function(){
    modal.style.display = "none";
  };

  modal.style.display = '';
}

// === Инфоблок и мини-модалка ===
function refreshInfoBlock() {
  fetch(`${API}/info`).then(res => res.json()).then(data => {
    infoBlockCache.max_win = data.max_win;
    infoBlockCache.last_win = data.last_win;
    renderInfoCards(data.online, data.max_win, data.last_win);
  }).catch(()=>{
  });
}
setInterval(refreshInfoBlock, 7000);
refreshInfoBlock();

function openInfoModal(type) {
  const modal = document.getElementById('modal-info');
  let info = type === 'max' ? infoBlockCache.max_win : infoBlockCache.last_win;
  document.getElementById('modal-info-title').innerText = type === 'max' ? 'Максимальный выигрыш' : 'Последний победитель';
  document.getElementById('modal-info-user').innerHTML = info?.username ? `@${info.username}` : '';
  document.getElementById('modal-info-prize').innerHTML = (info?.gifts || []).map(g =>
    `<img src="${g.img}" title="${g.name}">`
  ).join('');
  document.getElementById('modal-info-amount').innerText = info?.amount ? `${info.amount} TON` : '';
  modal.style.display = '';
}
document.getElementById('closeModalInfo').onclick = () => {
  document.getElementById('modal-info').style.display = 'none';
};

// === Опрос состояния раунда ===
setInterval(fetchRoundState, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) fetchRoundState();
});
window.addEventListener('focus', fetchRoundState);

let winnerPopupShown = false;
let isAnimating = false;

function fetchRoundState() {
  fetch(`${API}/round_state`).then(res => res.json()).then(data => {
    console.log('ROUND STATE:', data); // <-- добавь сюда
    roundData = data;
     if (data.winner) {
      data.players = data.players.map(player => ({
        ...player,
        is_winner: player.user_id === data.winner.user_id
      }));
    }
    updateBankUI(data.gifts, data.bank);
    updatePlayersUI(data.players);
    wheelState.players = data.players;

if (data.phase === "waiting") {
  const totalNeeded = 2;
  const currentPlayers = data.players.length;
  const percent = Math.min(100, (currentPlayers / totalNeeded) * 100);
  
  // Плавная анимация прогресс-бара
  const progressFill = document.getElementById('progress-fill');
  progressFill.style.transition = 'width 0.5s ease';
  progressFill.style.width = percent + '%';
  
  document.getElementById('waiting-text').innerText = 
    `Ожидание игроков... (${currentPlayers}/${totalNeeded})`;
}

    if (data.phase === "waiting" || !data.players || data.players.length < 2) {
      clearInterval(timerInterval);
      updateTimerText(0, "waiting");
      isSpinning = false;
      window.lastSpinAngle = null;
      document.getElementById('addGiftsBtn').disabled = false;
      document.getElementById('addTonBtn').disabled = false;
      winnerPopupShown = false;
    }

    else if (data.phase === "countdown" && data.start_time) {
      const now = Date.now() / 1000;
      let secondsLeft = Math.max(0, Math.floor(data.start_time - now));
      startVisualTimer(secondsLeft, "countdown");
      isSpinning = false;
      document.getElementById('addGiftsBtn').disabled = false;
      document.getElementById('addTonBtn').disabled = false;
      winnerPopupShown = false;
    }

   else if (data.phase === "spinning") {
  console.log('PHASE: spinning', data);
  clearInterval(timerInterval);
  updateTimerText(0, "spinning");
  document.getElementById('addGiftsBtn').disabled = true;
  document.getElementById('addTonBtn').disabled = true;

  // Запускаем анимацию всегда если есть winner_angle и не крутится
  if (data.winner_angle != null && !isAnimating) {
    isAnimating = true;
    animateWheelToAngle(data.winner_angle, data.players, () => {
      setTimeout(() => {
        isAnimating = false;
        isSpinning = false;
        document.getElementById('addGiftsBtn').disabled = false;
        document.getElementById('addTonBtn').disabled = false;
        fetchRoundState();
      }, 2000);
    });
  }
  winnerPopupShown = false;
}
    else if (data.phase === "finished") {
      console.log('PHASE: finished', data);
      clearInterval(timerInterval);
      updateTimerText(0, "finished");
      isSpinning = false;
      document.getElementById('addGiftsBtn').disabled = false;
      document.getElementById('addTonBtn').disabled = false;

      if (data.winner && !winnerPopupShown) {
        console.log('SHOW WINNER POPUP', data.winner);
        showWinnerPopup(data.winner.username, data.winner.gifts || []);
        winnerPopupShown = true;
      }
    } else if (data.phase !== "finished") {
      winnerPopupShown = false;
    }

    // Новый раунд — сбрасываем rotation, local round time
    if (data.start_time && data.start_time !== lastRoundTime) {
      wheelState.rotation = 0;
      localStorage.setItem('lastRoundTime', data.start_time);
      lastRoundTime = data.start_time;
    }
    drawWheel(data.players, wheelState.rotation);
    document.getElementById('winner').innerText = data.winner ? `Победитель: ${data.winner.username}` : "";
  }).catch(()=> {
    clearInterval(timerInterval);
    updateTimerText(0, "waiting");
  });
}

function getMiniAppSize() {
  let size = 260; // дефолтный размер
  
  if (window.Telegram?.WebApp?.viewportStableWidth) {
    const viewportWidth = window.Telegram.WebApp.viewportStableWidth;
    size = Math.min(viewportWidth * 0.70, 260);
  } else if (document.querySelector(".container")) {
    const containerWidth = document.querySelector(".container").offsetWidth;
    size = Math.min(containerWidth * 0.70, 260);
  } else {
    size = Math.min(window.innerWidth * 0.70, 260);
  }
  
  // Минимальный размер для мобильных
  return Math.max(size, 180);
}
// Глобальный кэш аватарок
const avatarCache = new Map();

function loadAvatar(url, callback) {
  if (avatarCache.has(url)) {
    callback(avatarCache.get(url));
    return;
  }
  
  const img = new Image();
  img.onload = () => {
    avatarCache.set(url, img);
    callback(img);
  };
  img.onerror = () => {
    // Fallback аватар
    const fallback = new Image();
    fallback.src = 'https://ui-avatars.com/api/?name=User';
    avatarCache.set(url, fallback);
    callback(fallback);
  };
  img.src = url;
}

function drawWheel(players, rotation = 0) {
  const canvas = document.getElementById('wheel');
  let size = getMiniAppSize();
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  if (!players || players.length === 0) return;

ctx.save();
ctx.beginPath();
ctx.arc(x, y, CIRCLE_RADIUS, 0, 2 * Math.PI);
ctx.closePath();
ctx.clip();
ctx.drawImage(img, x - CIRCLE_RADIUS * 0.8, y - CIRCLE_RADIUS * 0.8, CIRCLE_RADIUS * 1.6, CIRCLE_RADIUS * 1.6);
ctx.restore();

  const RADIUS = size * 0.44;
  const ICON_RADIUS = size * 0.30;
  const CIRCLE_RADIUS = size * 0.06;
  const ARROW_Y = size * 0.05;
  const ARROW_SIZE = size * 0.05;

  const weights = players.map(
    (p) => Math.max(1, (p.bet_ton || 0) + (p.gifts?.length || 0))
  );
  const total = weights.reduce((sum, w) => sum + w, 0);

  let startAngle = 0;
  const colors = [
    "#49b87a",
    "#57d7ff",
    "#ffe14f",
    "#c171f7",
    "#7a6af7",
    "#ff7575"
  ];
  for (let i = 0; i < players.length; i++) {
    const angle = (weights[i] / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2);
    ctx.arc(size / 2, size / 2, RADIUS, startAngle, startAngle + angle);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
  
    const theta = startAngle + angle / 2;
    const x = size / 2 + ICON_RADIUS * Math.cos(theta);
    const y = size / 2 + ICON_RADIUS * Math.sin(theta);

    ctx.beginPath();
    ctx.arc(x, y, CIRCLE_RADIUS, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.fillStyle = "#222";
    ctx.fill();

    const user = players[i];
    let avatarUrl = user.avatar || user.photo_url || 
                   `https://ui-avatars.com/api/?name=${user.username}`;

    if (user.user_id == TG_USER_ID && TG_AVATAR) {
      avatarUrl = TG_AVATAR;
    }

    // Используем кэширование
    loadAvatar(avatarUrl, (img) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, CIRCLE_RADIUS, 0, 2 * Math.PI);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(
        img,
        x - CIRCLE_RADIUS * 0.8,
        y - CIRCLE_RADIUS * 0.8,
        CIRCLE_RADIUS * 1.6,
        CIRCLE_RADIUS * 1.6
      );
      ctx.restore();
    });
  }

const img = new Image();
img.src = avatarUrl;
img.onload = () => {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, CIRCLE_RADIUS, 0, 2 * Math.PI); // <-- круглая область
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(
    img,
    x - CIRCLE_RADIUS * 0.8,
    y - CIRCLE_RADIUS * 0.8,
    CIRCLE_RADIUS * 1.6,
    CIRCLE_RADIUS * 1.6
  );
  ctx.restore();
};
if (img.complete) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, CIRCLE_RADIUS, 0, 2 * Math.PI);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(
    img,
    x - CIRCLE_RADIUS * 0.8,
    y - CIRCLE_RADIUS * 0.8,
    CIRCLE_RADIUS * 1.6,
    CIRCLE_RADIUS * 1.6
  );
  ctx.restore();
}

  // Стрелка (адаптивная)
  ctx.beginPath();
  ctx.moveTo(size / 2, ARROW_Y);
  ctx.lineTo(size / 2 - ARROW_SIZE, ARROW_Y + ARROW_SIZE * 1.5);
  ctx.lineTo(size / 2 + ARROW_SIZE, ARROW_Y + ARROW_SIZE * 1.5);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();
}

// === UI и прочее ===

function updateBankUI(gifts, bank) {
  document.getElementById('bank').innerText = `${gifts.length} гифтов • ${bank} TON`;
}

function updatePlayersUI(players) {
  const playersContainer = document.getElementById('players');
  playersContainer.innerHTML = players.map((p, index) => {
    let avatarUrl = p.avatar || p.photo_url || `https://ui-avatars.com/api/?name=${p.username}`;
    const isWinner = p.is_winner;
    const isTopPlayer = index < 3; // Топ-3 игрока
    
    return `
      <div class="${isWinner ? 'player-winner' : ''} ${isTopPlayer ? 'top-player' : ''}" 
           style="display:flex;align-items:center;padding:8px;margin:5px 0;border-radius:12px;position:relative;">
        ${isTopPlayer ? '<div class="winner-crown"></div>' : ''}
        <div class="${isTopPlayer ? 'vip-frame' : ''}">
          <img class="avatar" src="${avatarUrl}" style="width:32px;height:32px;border-radius:50%;" />
        </div>
        <span style="margin-left:10px;">@${p.username} (${p.bet_ton} TON)</span>
        <span style="margin-left:auto;">${p.gifts.map(g=>g.name).join(', ')}</span>
      </div>
    `;
  }).join('');
}

function showSuccessFeedback() {
  // Микро-конфетти
  confetti({
    particleCount: 20,
    spread: 30,
    origin: { y: 0.6 }
  });
  
  // Виброотклик
  if (window.Telegram?.WebApp?.HapticFeedback) {
    window.Telegram.WebApp.HapticFeedback.impactOccurred('soft');
  }
  
  // Анимация кнопки
  const buttons = document.querySelectorAll('.btn');
  buttons.forEach(btn => {
    btn.style.transition = 'transform 0.2s';
    btn.style.transform = 'translateY(2px)';
    setTimeout(() => {
      btn.style.transform = 'translateY(0)';
    }, 200);
  });
}

// В HTML добавь <canvas id="crowns-bg"></canvas> после .glass-bg


// === Инвентарь ===
function refreshInventory() {
  fetch(`${API}/inventory/${TG_USER_ID}`)
    .then(res => res.json())
    .then(data => {
      const inv = data.inventory;
      const hint = document.getElementById('empty-inventory-hint');
      if (inv.length === 0) {
        hint.style.display = '';
        document.getElementById('inventoryList').innerHTML = '';
        document.getElementById('withdrawBtn').style.display = 'none';
      } else {
        hint.style.display = 'none';
document.getElementById('inventoryList').innerHTML = inv.map(g =>
  `<div>
    <img class="gift-img" src="${g.img}" width="40"> ${g.name}
    <span style="margin-left:12px;color:#ffe14f;">${g.price ? g.price + ' TON' : ''}</span>
    <input type="checkbox" value="${g.id}" onchange="toggleGift('${g.id}')">
  </div>`
).join('');
        document.getElementById('withdrawBtn').style.display = inv.length > 0 ? '' : 'none';
      }
    }).catch(()=>{});
}
function toggleGift(id) {
  if (state.selectedGifts.includes(id)) {
    state.selectedGifts = state.selectedGifts.filter(g => g !== id);
  } else {
    state.selectedGifts.push(id);
  }
}

// === Кнопки ===
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('addGiftsBtn').onclick = function() {
    fetch(`${API}/inventory/${TG_USER_ID}`)
      .then(res => res.json())
      .then(data => {
        if (data.inventory.length === 0) {
          document.getElementById('no-gifts-modal').style.display = '';
        } else {
          showChooseGiftModal(data.inventory);
        }
      });
  };

  document.getElementById('bee-addGiftsBtn').onclick = function() {
  fetch(`${API}/inventory/${TG_USER_ID}`)
    .then(res => res.json())
    .then(data => {
      if (data.inventory.length === 0) {
        document.getElementById('no-gifts-modal').style.display = '';
      } else {
        showBeeChooseGiftModal(data.inventory); // <-- новая функция для bee
      }
    });
};

 document.getElementById('bee-addTonBtn').onclick = async function() {
  let amount = prompt("Сколько TON поставить?");
  amount = Number(amount);
  if (isNaN(amount) || amount <= 0) return;

  const nanoTon = Math.floor(amount * 1e9);
  const depositAddress = 'UQAq3oyvpiAsimXijqmINv13b_zYcwZdebHZ20yVd4Agmgpc';

  const transaction = {
    validUntil: Math.floor(Date.now() / 1000) + 600,
    messages: [
      {
        address: depositAddress,
        amount: String(nanoTon),
        payload: ''
      }
    ]
  };

  try {
    const result = await tonConnectUI.sendTransaction(transaction);
    const userWalletAddress = tonConnectUI.wallet.account.address;
    
    // Для bee раунда нужно использовать другую функцию, например beeJoinRound
    // Если у вас есть аналогичная функция для bee:
    beeJoinRound(TG_USER_ID, TG_USERNAME, amount, [], userWalletAddress);
    
  } catch (err) {
    alert('Ошибка/отмена транзакции!');
  }
};

document.getElementById('addTonBtn').onclick = async function() {
  let amount = prompt("Сколько TON поставить?");
  amount = Number(amount);
  if (isNaN(amount) || amount <= 0) return;

  // --- сумма в нанотонах ---
  const nanoTon = Math.floor(amount * 1e9);

  // --- твой TON адрес ---
  const depositAddress = 'UQAq3oyvpiAsimXijqmINv13b_zYcwZdebHZ20yVd4Agmgpc';

  // --- формируем транзакцию ---
  const transaction = {
    validUntil: Math.floor(Date.now() / 1000) + 600, // 10 минут
    messages: [
      {
        address: depositAddress,
        amount: String(nanoTon),
        payload: ''
      }
    ]
  };

  try {
    // Отправляем TON через TON Connect
    const result = await tonConnectUI.sendTransaction(transaction);

    // Получаем адрес пользователя из wallet/account
    const userWalletAddress = tonConnectUI.wallet.account.address;
    console.log('userWalletAddress:', userWalletAddress);

    // ЗДЕСЬ ЗАМЕНА - используем joinRound вместо fetch
    joinRound(TG_USER_ID, TG_USERNAME, amount, [], userWalletAddress);
    
  } catch (err) {
    alert('Ошибка/отмена транзакции!');
  }
};

window.Telegram.WebApp.onEvent('invoiceClosed', function(event) {
  if (event.status === 'paid') {
    // Выводи подарок, отправь запрос на backend для фиксации
    fetch('/api/withdraw_gift', {
      method: 'POST',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: TG_USER_ID, gift_id: GIFT_ID })
    }).then(/* ... */);
  }
});

  document.getElementById('withdrawBtn').onclick = function() {
    selectedGifts.forEach(id => {
      fetch(`${API}/withdraw_gift`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({user_id: TG_USER_ID, gift_id: id})
      }).then(refreshInventory);
    });
    selectedGifts = [];
  };
  // ВОТ ЭТО для кнопки "Понятно"
  document.getElementById('closeNoGiftsModal').onclick = function() {
    document.getElementById('no-gifts-modal').style.display = 'none';
  };
});
// === Модалка выбора подарка ===
function showChooseGiftModal(gifts) {
  const modal = document.getElementById('choose-gift-modal');
  const list = document.getElementById('choose-gift-list');
  const confirmBtn = document.getElementById('chooseGiftConfirmBtn');
  let selectedGiftId = null;

  list.innerHTML = gifts.map(g =>
    `<div class="choose-gift-item" data-gift-id="${g.id}">
      <img src="${g.img}" alt="">
      <span>${g.name}</span>
    </div>`
  ).join('');

  confirmBtn.disabled = true;
  selectedGiftId = null;

  Array.from(list.children).forEach(el => {
    el.onclick = function() {
      Array.from(list.children).forEach(c => c.classList.remove("selected"));
      el.classList.add("selected");
      selectedGiftId = el.getAttribute("data-gift-id");
      confirmBtn.disabled = false;
    };
  });

  confirmBtn.onclick = function() {
    if (!selectedGiftId) return;
    fetch(`${API}/join_round`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({user_id: TG_USER_ID, username: TG_USERNAME, bet_ton: 0, gifts: [selectedGiftId]})
    }).then(() => {
      modal.style.display = "none";
      fetchRoundState(); // Фикс: сразу обновить!
    });
  };

  document.getElementById('closeChooseGiftModal').onclick = function(){
    modal.style.display = "none";
  };

  modal.style.display = '';
}

tonConnectUI.onStatusChange(wallet => {
  if (wallet) {
    console.log('TON Wallet connected:', wallet.account.address);
    // Сохрани этот адрес для депозита или в профиль пользователя
  }
});

// === Профиль ===
function refreshProfile() {
  fetch(`${API}/profile/${TG_USER_ID}`)
    .then(res => res.json())
    .then(data => {
      document.getElementById('profile-avatar').src = TG_AVATAR || data.avatar || `https://ui-avatars.com/api/?name=${TG_USERNAME}`;
      document.getElementById('profile-username').innerText = `@${TG_USERNAME}`;
      document.getElementById('profile-earn').innerHTML = `Заработано: <span>${data.earn} TON</span>`;
      document.getElementById('withdraw-history').innerHTML = data.withdraw_history.map(row =>
        `<div class="withdraw-row">
           <span>${row.date}</span>
           <span>
             ${row.gifts.map(g=>`<img class="gift-img" src="${g.img}" title="${g.name}">`).join('')}
           </span>
         </div>`
      ).join('');
    }).catch(()=>{});
}
  
function animateWheelToAngle(angle, players, callback) {
  let duration = 3000; // 3 секунды
  let start = performance.now();
  let startRotation = wheelState.rotation || 0;
  let targetRotation = 8 * Math.PI + angle;

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // === Всплывашка победителя ===
function showBeeWinnerPopup(username, gifts) {
  const popup = document.getElementById('winner-popup');
  document.getElementById('winner-popup-nick').innerText = `Победитель: @${username}`;
  document.getElementById('winner-popup-gifts').innerHTML = gifts.map(g =>
    `<img src="${g.img}" title="${g.name}" alt="${g.name}">`
  ).join('');
  popup.classList.add('show');
  popup.style.display = '';
  setTimeout(() => {
    popup.classList.remove('show');
    setTimeout(() => popup.style.display = 'none', 600);
  }, 4000);
}

document.getElementById('openHistoryBtn').onclick = openHistoryModal;
document.getElementById('closeHistoryModal').onclick = function() {
  document.getElementById('history-modal').style.display = 'none';
};


  function animate(now) {
    let progress = Math.min((now - start) / duration, 1);
    let rotation = startRotation + (targetRotation - startRotation) * easeOutCubic(progress);
    wheelState.rotation = rotation;
    drawWheel(players, rotation);
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      wheelState.rotation = angle;
      drawWheel(players, angle);
      if (callback) callback();
    }
  }
  requestAnimationFrame(animate);
}

// === Всплывашка победителя ===
function showWinnerPopup(username, gifts) {
  // ЗАПУСКАЕМ КОНФЕТТИ
  confetti({
    particleCount: 150,
    spread: 70,
    origin: { y: 0.6 }
  });
  const popup = document.getElementById('winner-popup');
  document.getElementById('winner-popup-nick').innerText = `Победитель: @${username}`;
  document.getElementById('winner-popup-gifts').innerHTML = gifts.map(g =>
    `<img src="${g.img}" title="${g.name}" alt="${g.name}">`
  ).join('');
  popup.classList.add('show');
  popup.style.display = '';
  setTimeout(() => {
    popup.classList.remove('show');
    setTimeout(() => popup.style.display = 'none', 600);
  }, 4000);
}

document.getElementById('openHistoryBtn').onclick = openHistoryModal;
document.getElementById('closeHistoryModal').onclick = function() {
  document.getElementById('history-modal').style.display = 'none';
};

function openHistoryModal() {
  document.getElementById('history-modal').style.display = '';
  fetch('/api/round_history?limit=30')
    .then(res => res.json())
    .then(data => {
      renderHistoryList(data.history);
    });
}

setInterval(() => {
  if (beeRoundData) {
    console.log('BEE PHASE:', beeRoundData.phase, 'Players:', beeRoundData.players.length);
  }
}, 1000);

function renderHistoryList(history) {
  const list = document.getElementById('history-list');
  list.innerHTML = history.map(round => `
    <div class="history-round">
      <div class="history-head">
        <span class="history-roll">Игра</span>
        <span class="history-id">#${round.id}</span>
        <span class="history-date">${round.date}</span>
        <span class="history-time">${round.time}</span>
      </div>
      <div class="history-winner">
        <img class="avatar" src="${round.avatar || 'https://ui-avatars.com/api/?name='+round.username}" />
        <span class="history-username">@${round.username}</span>
        <span class="history-amount">Выиграл ${round.amount} TON</span>
        <span class="history-chance">${round.chance}%</span>
      </div>
      <div class="history-gifts">
        ${round.gifts.slice(0, 8).map(g => `<img src="${g.img}" title="${g.name}" class="gift-img">`).join('')}
        ${round.gifts.length > 8 ? `<span class="gift-more">+${round.gifts.length - 8}</span>` : ''}
      </div>
    </div>
  `).join('');
}

document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', function(e) {
  // F12, Ctrl+Shift+I, Ctrl+U, Ctrl+S
  if (e.keyCode === 123) e.preventDefault();
  if (e.ctrlKey && e.shiftKey && e.keyCode === 73) e.preventDefault();
  if (e.ctrlKey && e.keyCode === 85) e.preventDefault();
  if (e.ctrlKey && e.keyCode === 83) e.preventDefault();
});

// === Вкладки ===
let beePollingInterval = null;
function showTab(tab) {
  document.getElementById('pvp').style.display = tab === 'pvp' ? '' : 'none';
  document.getElementById('inventory').style.display = tab === 'inventory' ? '' : 'none';
  document.getElementById('profile').style.display = tab === 'profile' ? '' : 'none';
  document.getElementById('bee').style.display = tab === 'bee' ? '' : 'none';

  document.getElementById('tab-pvp').classList.toggle('selected', tab === 'pvp');
  document.getElementById('tab-inventory').classList.toggle('selected', tab === 'inventory');
  document.getElementById('tab-profile').classList.toggle('selected', tab === 'profile');
  document.getElementById('tab-bee').classList.toggle('selected', tab === 'bee');

  if(tab === 'bee') {
    fetchBeeRoundState();
    if (beePollingInterval) clearInterval(beePollingInterval);
    beePollingInterval = setInterval(fetchBeeRoundState, 1000);
  } else {
    if (beePollingInterval) clearInterval(beePollingInterval);
  }

  if(tab === 'profile') refreshProfile();
}

function updateBeeBankUI(gifts) {
  let totalTon = gifts.reduce((acc, g) => acc + (g.price || 0), 0);
  document.getElementById('bee-bank').innerText = `${gifts.length} гифтов • ${totalTon} TON`;
}

// --- Bee UI ---
// --- Bee UI ---
function updateBeePlayersUI(players) {
  document.getElementById('bee-players').innerHTML = players.map(p => {
    let avatarUrl = p.avatar || `https://ui-avatars.com/api/?name=${p.username}`;
    return `<div style="display:flex;align-items:center;margin-bottom:6px;">
      <img class="avatar" src="${avatarUrl}" />
      <span style="margin-left:8px;font-weight:700;">@${p.username}</span>
      <span style="margin-left:12px;color:#57d7ff;">${p.gifts.length} пчёл</span>
      <span style="margin-left:12px;color:#ffe14f;">${p.bet_ton||0} TON</span>
    </div>`;
  }).join('');
} // ← добавь эту скобку!

// Обработчик быстрых ставок
// Добавьте в обработчик быстрых кнопок:
// Обработчик быстрых ставок (добавьте в DOMContentLoaded)
document.addEventListener('DOMContentLoaded', function() {
  // ... другой код ...
  
  // Обработчик быстрых кнопок
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('quick-ton-btn')) {
      const amount = parseFloat(e.target.getAttribute('data-amount'));
      
      // Анимация кнопки
      e.target.style.transform = 'scale(0.95)';
      setTimeout(() => {
        e.target.style.transform = 'scale(1)';
      }, 100);
      
      // Виброотклик
      if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
      }
      
      // Закрываем модалку выбора подарка
      document.getElementById('choose-gift-modal').style.display = 'none';
      
      // Отправляем ставку
      if (tonConnectUI.connected) {
        sendTonBet(amount);
      } else {
        alert('Сначала подключите кошелёк TON!');
      }
    }
  });
});

// Функция отправки ставки (добавьте в app.js)
async function sendTonBet(amount) {
  const nanoTon = Math.floor(amount * 1e9);
  const depositAddress = 'UQAq3oyvpiAsimXijqmINv13b_zYcwZdebHZ20yVd4Agmgpc';

  const transaction = {
    validUntil: Math.floor(Date.now() / 1000) + 600,
    messages: [{
      address: depositAddress,
      amount: String(nanoTon),
      payload: ''
    }]
  };

      // Микро-конфетти при успехе
    confetti({
      particleCount: 30,
      spread: 40,
      origin: { y: 0.6 }
    });

  try {
    const result = await tonConnectUI.sendTransaction(transaction);
    const userWalletAddress = tonConnectUI.wallet.account.address;
    
    // Показываем успех
    showSuccessFeedback();
    
    // Отправляем ставку на сервер
    joinRound(TG_USER_ID, TG_USERNAME, amount, [], userWalletAddress);
    
  } catch (err) {
    console.error('Ошибка транзакции:', err);
    alert('Ошибка при отправке TON!');
  }
}

// Реферальная система
// Реферальная система (frontend-only)
function openReferralModal() {
  // Получаем данные из localStorage
  const refData = JSON.parse(localStorage.getItem('referral_data') || '{}');
  const myStats = refData[TG_USER_ID] || { invited: 0, earned: 0 };
  
  // Показываем статистику
  document.getElementById('ref-invited').textContent = myStats.invited || 0;
  document.getElementById('ref-earned').textContent = (myStats.earned || 0) + ' TON';
  document.getElementById('ref-link').value = `https://t.me/your_bot?start=ref_${TG_USER_ID}`;
  document.getElementById('referral-modal').style.display = '';
}

// Функция копирования ссылки
function copyRefLink() {
  const linkInput = document.getElementById('ref-link');
  linkInput.select();
  document.execCommand('copy');
  alert('Ссылка скопирована в буфер!');
}

// Функция поделиться
function shareRefLink() {
  if (window.Telegram && window.Telegram.WebApp) {
    window.Telegram.WebApp.shareUrl(
      `https://t.me/your_bot?start=ref_${TG_USER_ID}`,
      'Присоединяйся к игре и получай бонусы!'
    );
  } else {
    copyRefLink();
  }
}

// Проверка реферальной ссылки при загрузке
function checkRefOnLoad() {
  const urlParams = new URLSearchParams(window.location.search);
  const refParam = urlParams.get('ref');
  
  if (refParam && refParam.startsWith('ref_')) {
    const referrerId = refParam.replace('ref_', '');
    saveReferral(referrerId);
  }
}

// Сохранение реферала
function saveReferral(referrerId) {
  if (referrerId === TG_USER_ID) return; // Нельзя пригласить себя
  
  const refData = JSON.parse(localStorage.getItem('referral_data') || '{}');
  
  // Проверяем, не был ли уже приглашен
  if (!localStorage.getItem('was_referred')) {
    // Сохраняем кто пригласил
    localStorage.setItem('was_referred', referrerId);
    
    // Обновляем статистику пригласившего
    if (!refData[referrerId]) {
      refData[referrerId] = { invited: 0, earned: 0 };
    }
    refData[referrerId].invited = (refData[referrerId].invited || 0) + 1;
    
    localStorage.setItem('referral_data', JSON.stringify(refData));
    
    console.log('Реферал сохранен:', referrerId);
  }
}

// Начисление процентов рефереру (вызывать при успешной ставке)
function addReferralEarnings(amount) {
  const referrerId = localStorage.getItem('was_referred');
  if (!referrerId) return;
  
  const refData = JSON.parse(localStorage.getItem('referral_data') || '{}');
  const percent = 0.05; // 5%
  const earnings = amount * percent;
  
  if (!refData[referrerId]) {
    refData[referrerId] = { invited: 0, earned: 0 };
  }
  
  refData[referrerId].earned = (refData[referrerId].earned || 0) + earnings;
  localStorage.setItem('referral_data', JSON.stringify(refData));
  
  console.log(`Начислено ${earnings} TON рефереру ${referrerId}`);
}

// Вызвать при загрузке
checkRefOnLoad();

function copyRefLink() {
  const linkInput = document.getElementById('ref-link');
  linkInput.select();
  document.execCommand('copy');
  alert('Ссылка скопирована!');
}

function shareRefLink() {
  if (window.Telegram && window.Telegram.WebApp) {
    window.Telegram.WebApp.shareUrl(
      `https://t.me/your_bot?start=ref_${TG_USER_ID}`,
      'Присоединяйся к игре и получай бонусы!'
    );
  } else {
    copyRefLink();
  }
}
// Управление темой
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  const systemTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const theme = savedTheme === 'auto' ? systemTheme : savedTheme;
  
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-toggle').checked = theme === 'dark';
}

function toggleTheme() {
  const isDark = document.getElementById('theme-toggle').checked;
  const theme = isDark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

// Проверка реферала из URL
function checkRefParameter() {
  const urlParams = new URLSearchParams(window.location.search);
  const ref = urlParams.get('ref');
  
  if (ref && ref.startsWith('ref_')) {
    const referrerId = ref.replace('ref_', '');
    localStorage.setItem('referrer', referrerId);
    console.log('Реферал обнаружен:', referrerId);
  }
}

// Вызвать при загрузке
checkRefParameter();

// Генерация правильной реферальной ссылки
function generateRefLink() {
  return `https://t.me/${ROYALPVP_BOT}?start=ref_${TG_USER_ID}`;
}

// Проверка рефералов при загрузке
function checkReferral() {
  const urlParams = new URLSearchParams(window.location.search);
  const refParam = urlParams.get('ref');
  
  if (refParam) {
    // Отправить на сервер информацию о реферале
    fetch(`${API}/track_referral`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        user_id: TG_USER_ID,
        referrer_id: refParam
      })
    });
  }
}

// Вызвать при загрузке
checkReferral();

// Инициализировать тему при загрузке
initTheme();

    // Заполняем поле ввода (если есть) или сразу отправляем
    const input = document.querySelector('input[type="number"]');
    if (input) input.value = amount;
    
    // Если нужно сразу отправить, раскомментируй:
    // if (tonConnectUI.connected) {
    //   sendTonBet(amount);
    // }

showTab('pvp');
fetchRoundState();
setInterval(refreshInventory, 5000);