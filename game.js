(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = 1280;
  const H = 720;
  const GROUND_Y = 568;

  const screens = {
    start: document.getElementById("startScreen"),
    calibration: document.getElementById("calibrationScreen"),
    error: document.getElementById("errorScreen"),
    result: document.getElementById("resultScreen"),
  };

  const ui = {
    hud: document.getElementById("hud"),
    distance: document.getElementById("distanceText"),
    flowers: document.getElementById("flowerText"),
    time: document.getElementById("timeText"),
    voiceMeter: document.getElementById("voiceMeter"),
    lifeHearts: document.getElementById("lifeHearts"),
    calibrationMeter: document.getElementById("calibrationMeter"),
    calibrationTitle: document.getElementById("calibrationTitle"),
    calibrationText: document.getElementById("calibrationText"),
    countdown: document.getElementById("countdownText"),
    errorText: document.getElementById("errorText"),
    resultEyebrow: document.getElementById("resultEyebrow"),
    resultTitle: document.getElementById("resultTitle"),
    finalDistance: document.getElementById("finalDistance"),
    finalFlowers: document.getElementById("finalFlowers"),
    finalLives: document.getElementById("finalLives"),
    finalBadge: document.getElementById("finalBadge"),
    resultNote: document.getElementById("resultNote"),
  };

  const buttons = {
    start: document.getElementById("startButton"),
    demo: document.getElementById("demoButton"),
    retry: document.getElementById("retryButton"),
    fallback: document.getElementById("fallbackButton"),
    restart: document.getElementById("restartButton"),
    fullscreen: document.getElementById("fullscreenButton"),
  };

  const audio = {
    context: null,
    analyser: null,
    source: null,
    data: null,
    micReady: false,
    demoMode: false,
    raw: 0,
    smoothed: 0,
    quiet: 0.015,
    shout: 0.18,
    threshold: 0.045,
    keyboardDown: false,
    unlocked: false,
  };

  const game = {
    mode: "start",
    lastTime: 0,
    elapsed: 0,
    distance: 0,
    flowers: 0,
    maxLives: 3,
    lives: 3,
    score: 0,
    speed: 300,
    shake: 0,
    obstacleTimer: 0.9,
    rewardTimer: 0.45,
    cloudOffset: 0,
    overVoiceTime: 0,
    invincible: 0,
    lastHitReason: "",
    endedBy: "",
    dino: null,
    obstacles: [],
    rewards: [],
    particles: [],
    floatText: [],
  };

  const palettes = {
    skyTop: "#66ceff",
    skyBottom: "#dff9ff",
    mint: "#68d6b5",
    dino: "#69cfaa",
    dinoDark: "#24966f",
    orange: "#ff9f2e",
    red: "#f25064",
    yellow: "#ffd568",
    purple: "#8665df",
    ink: "#20303a",
    cream: "#fff8de",
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function pick(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function roundedRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function setMode(mode) {
    game.mode = mode;
    Object.entries(screens).forEach(([name, screen]) => {
      screen.classList.toggle("is-active", name === mode);
    });
    ui.hud.classList.toggle("is-active", mode === "playing");
  }

  function formatMeters(value) {
    return `${Math.max(0, Math.round(value))}m`;
  }

  function updateHud() {
    ui.distance.textContent = formatMeters(game.distance);
    ui.flowers.textContent = String(game.flowers);
    ui.time.textContent = String(Math.max(0, Math.ceil(60 - game.elapsed)));
    [...ui.lifeHearts.children].forEach((heart, index) => {
      heart.classList.toggle("is-empty", index >= game.lives);
    });
    ui.voiceMeter.style.width = `${clamp(audio.smoothed * 100, 0, 100)}%`;
    ui.calibrationMeter.style.width = `${clamp(audio.smoothed * 100, 0, 100)}%`;
  }

  async function ensureAudio() {
    if (audio.context && audio.context.state === "suspended") {
      await audio.context.resume();
    }

    if (!audio.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audio.context = new AudioContext();
    }

    if (audio.micReady) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });

    audio.analyser = audio.context.createAnalyser();
    audio.analyser.fftSize = 1024;
    audio.analyser.smoothingTimeConstant = 0.16;
    audio.data = new Uint8Array(audio.analyser.fftSize);
    audio.source = audio.context.createMediaStreamSource(stream);
    audio.source.connect(audio.analyser);
    audio.micReady = true;
    audio.demoMode = false;
  }

  function updateAudio() {
    let normalized = 0;

    if (audio.analyser && audio.data) {
      audio.analyser.getByteTimeDomainData(audio.data);
      let sum = 0;
      for (let i = 0; i < audio.data.length; i += 1) {
        const v = (audio.data[i] - 128) / 128;
        sum += v * v;
      }
      audio.raw = Math.sqrt(sum / audio.data.length);
      const usableRange = Math.max(0.035, audio.shout - audio.threshold);
      normalized = clamp((audio.raw - audio.threshold) / usableRange, 0, 1.25);
    }

    if (audio.keyboardDown || audio.demoMode) {
      normalized = Math.max(normalized, audio.keyboardDown ? 0.82 : 0);
    }

    const rise = normalized > audio.smoothed ? 0.36 : 0.12;
    audio.smoothed = lerp(audio.smoothed, normalized, rise);
  }

  function playTone(type) {
    if (!audio.context || audio.context.state !== "running") return;
    const oscillator = audio.context.createOscillator();
    const gain = audio.context.createGain();
    const now = audio.context.currentTime;
    const settings = {
      jump: [520, 0.028, 0.06],
      collect: [880, 0.04, 0.08],
      bump: [190, 0.05, 0.12],
      ready: [660, 0.035, 0.09],
    }[type] || [440, 0.03, 0.08];

    oscillator.type = type === "bump" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(settings[0], now);
    oscillator.frequency.exponentialRampToValueAtTime(settings[0] * 1.35, now + settings[2]);
    gain.gain.setValueAtTime(settings[1], now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + settings[2]);
    oscillator.connect(gain);
    gain.connect(audio.context.destination);
    oscillator.start(now);
    oscillator.stop(now + settings[2]);
  }

  function sampleFor(durationMs, onTick) {
    const samples = [];
    const started = performance.now();

    return new Promise((resolve) => {
      const timer = window.setInterval(() => {
        updateAudio();
        samples.push(audio.raw || 0);
        if (onTick) onTick((performance.now() - started) / durationMs);
        if (performance.now() - started >= durationMs) {
          window.clearInterval(timer);
          resolve(samples);
        }
      }, 42);
    });
  }

  function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = clamp(Math.floor(sorted.length * ratio), 0, sorted.length - 1);
    return sorted[index];
  }

  async function startWithMic() {
    setMode("calibration");
    ui.countdown.textContent = "";
    ui.calibrationTitle.textContent = "正在准备麦克风";
    ui.calibrationText.textContent = "第一次打开时，浏览器会询问麦克风权限。";

    try {
      await ensureAudio();
      await calibrateAndStart();
    } catch (error) {
      ui.errorText.textContent = "没有拿到麦克风权限，或当前浏览器不支持本地声音输入。";
      setMode("error");
    }
  }

  async function calibrateAndStart() {
    ui.calibrationTitle.textContent = "先安静一下";
    ui.calibrationText.textContent = "让啊啊龙听听现场底噪，2 秒就好。";
    const quietSamples = await sampleFor(2000, (progress) => {
      ui.calibrationMeter.style.width = `${clamp(progress * 100, 0, 100)}%`;
    });

    audio.quiet = Math.max(0.004, percentile(quietSamples, 0.8));
    ui.calibrationTitle.textContent = "现在 啊—— 一声";
    ui.calibrationText.textContent = "不用喊破嗓子，稳定出声就可以。";
    ui.calibrationMeter.style.width = "0%";

    const shoutSamples = await sampleFor(2200, () => {
      const level = clamp((audio.raw - audio.quiet) / 0.22, 0, 1);
      ui.calibrationMeter.style.width = `${level * 100}%`;
    });

    audio.shout = Math.max(percentile(shoutSamples, 0.9), audio.quiet + 0.075);
    audio.threshold = audio.quiet + (audio.shout - audio.quiet) * 0.26;
    audio.smoothed = 0;

    playTone("ready");
    ui.calibrationTitle.textContent = "准备起飞";
    ui.calibrationText.textContent = "对着麦克风 啊——，啊啊龙就会跳起来。";
    ui.calibrationMeter.style.width = "100%";

    for (const text of ["3", "2", "1", "啊！"]) {
      ui.countdown.textContent = text;
      await new Promise((resolve) => window.setTimeout(resolve, text === "啊！" ? 420 : 640));
    }

    startGame();
  }

  function startDemo() {
    audio.demoMode = true;
    audio.micReady = false;
    audio.threshold = 0.05;
    audio.shout = 0.25;
    audio.smoothed = 0;
    startGame();
  }

  function makeDino() {
    return {
      x: 190,
      y: GROUND_Y - 96,
      width: 112,
      height: 96,
      vy: 0,
      onGround: true,
      mouth: 0,
      bob: 0,
      blink: 0,
    };
  }

  function startGame() {
    game.elapsed = 0;
    game.distance = 0;
    game.flowers = 0;
    game.lives = game.maxLives;
    game.score = 0;
    game.speed = 280;
    game.shake = 0;
    game.obstacleTimer = 1.65;
    game.rewardTimer = 0.55;
    game.overVoiceTime = 0;
    game.invincible = 0;
    game.lastHitReason = "";
    game.endedBy = "";
    game.dino = makeDino();
    game.obstacles = [];
    game.rewards = [];
    game.particles = [];
    game.floatText = [];
    playTone("ready");
    setMode("playing");
  }

  function endGame(reason) {
    if (game.mode !== "playing") return;
    game.endedBy = reason;
    setMode("result");
    playTone(reason === "victory" ? "ready" : "bump");

    const badge = getBadge();
    ui.resultEyebrow.textContent = reason === "victory" ? "60 秒完成！" : "挑战结束";
    ui.resultTitle.textContent = reason === "victory" ? "童心发动机满电" : getResultTitle(reason);
    ui.finalDistance.textContent = formatMeters(game.distance);
    ui.finalFlowers.textContent = String(game.flowers);
    ui.finalLives.textContent = `${Math.max(0, game.lives)}`;
    ui.finalBadge.textContent = badge;
    ui.resultNote.textContent = getResultNote(reason);
  }

  function getBadge() {
    if (game.distance > 780 && game.flowers >= 9) return "彩虹音浪王";
    if (game.distance > 620) return "童心飞行员";
    if (game.flowers >= 7) return "小红花收割机";
    if (game.distance > 360) return "啊啊稳定器";
    return "啊啊新手";
  }

  function getResultTitle(reason) {
    const titles = {
      notebook: "被作业本糊脸了",
      alarm: "被闹钟怪催早起了",
      sign: "撞上 KPI 路牌了",
      cloud: "被安静云吸住了",
      balloon: "麦克风气球飘走了",
      sky: "啊得太猛，飞到云上了",
      outOfLives: "三条命用完了",
    };
    return titles[reason] || "童心发动机休息一下";
  }

  function getResultNote(reason) {
    const lastHitNotes = {
      notebook: "作业本怪扣掉了一点童心，吃零食可以补回来。",
      alarm: "闹钟怪会扣童心，稳定控制高度就能少撞几次。",
      sign: "KPI 路牌不可怕，小红花和零食能把童心补回来。",
      cloud: "安静云在天上，喊太高会被它蹭掉童心。",
      balloon: "麦克风气球会扣童心，断断续续更好控。",
    };
    const notes = {
      notebook: "下次提前 啊—— 一下，就能越过作业怪。",
      alarm: "声音稳一点，闹钟怪追不上你。",
      sign: "KPI 不可怕，小红花更重要。",
      cloud: "安静云在天上，喊太高会撞到它。",
      balloon: "不要一直猛冲，断断续续更好控。",
      sky: "不用喊破嗓子，稳定啊就可以。",
      outOfLives: lastHitNotes[game.lastHitReason] || "偶尔会出现爱心，吃到就能补回一条命。",
      victory: "你把童年跑道点亮了，奖励自己一朵小红花。",
    };
    return notes[reason] || "你把作业怪吓了一跳。";
  }

  function damageDino(obstacle) {
    if (game.invincible > 0 || obstacle.hit) return;

    obstacle.hit = true;
    game.lastHitReason = obstacle.type;
    game.lives = clamp(game.lives - 1, 0, game.maxLives);
    game.invincible = 1.2;
    game.shake = 8;
    game.dino.vy = -260;
    game.dino.onGround = false;

    addParticles(game.dino.x + 56, game.dino.y + 42, "#ff6b6b", 16);
    addFloatText("-1 生命", game.dino.x + 54, game.dino.y - 8, "#f25064");
    playTone("bump");

    if (game.lives <= 0) {
      endGame("outOfLives");
    }
  }

  function addLife(reward) {
    if (game.lives < game.maxLives) {
      game.lives += 1;
      return true;
    } else {
      game.score += 120;
      return false;
    }
  }

  function spawnObstacle() {
    const elapsed = game.elapsed;
    const options =
      elapsed < 30
        ? ["notebook", "alarm", "sign"]
        : elapsed < 45
          ? ["notebook", "alarm", "sign", "notebook", "alarm", "sign", "cloud"]
          : ["notebook", "alarm", "sign", "notebook", "alarm", "sign", "cloud", "balloon"];
    const type = pick(options);
    const base = {
      type,
      x: W + 90,
      passed: false,
      wobble: rand(0, Math.PI * 2),
      hit: false,
    };

    if (type === "cloud") {
      Object.assign(base, { y: rand(225, 330), width: 138, height: 76 });
    } else if (type === "balloon") {
      Object.assign(base, { y: rand(185, 310), width: 82, height: 138 });
    } else if (type === "sign") {
      Object.assign(base, { y: GROUND_Y - 118, width: 76, height: 118 });
    } else if (type === "alarm") {
      Object.assign(base, { y: GROUND_Y - 90, width: 86, height: 90 });
    } else {
      Object.assign(base, { y: GROUND_Y - 108, width: 82, height: 108 });
    }

    game.obstacles.push(base);
  }

  function spawnReward() {
    const missingLife = game.lives < game.maxLives;
    const heartChance = missingLife && game.elapsed > 10 ? 0.1 : 0.025;
    const type = Math.random() < heartChance ? "heart" : pick(["flower", "lollipop", "marble", "console", "snack"]);
    const high = game.elapsed > 18 && Math.random() > 0.62;
    game.rewards.push({
      type,
      x: W + rand(70, 220),
      y: high ? rand(230, 385) : rand(GROUND_Y - 190, GROUND_Y - 130),
      size: type === "console" || type === "heart" ? 48 : 42,
      spin: rand(0, Math.PI * 2),
      collected: false,
    });
  }

  function addParticles(x, y, color, amount = 10) {
    for (let i = 0; i < amount; i += 1) {
      game.particles.push({
        x,
        y,
        vx: rand(-120, 120),
        vy: rand(-180, -40),
        life: rand(0.38, 0.72),
        maxLife: 0.72,
        size: rand(4, 9),
        color,
      });
    }
  }

  function addFloatText(text, x, y, color = "#f25064") {
    game.floatText.push({
      text,
      x,
      y,
      vy: -34,
      life: 0.8,
      color,
    });
  }

  function getDinoHitbox() {
    const d = game.dino;
    return {
      x: d.x + 30,
      y: d.y + 22,
      width: d.width - 50,
      height: d.height - 36,
    };
  }

  function intersects(a, b) {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  function updateGame(dt) {
    if (game.mode !== "playing") return;
    game.elapsed += dt;
    game.speed = 280 + Math.min(135, Math.max(0, game.elapsed - 8) * 2.8);
    game.distance += (game.speed * dt) / 22;
    game.cloudOffset += dt * 18;
    game.shake = Math.max(0, game.shake - dt * 12);
    game.invincible = Math.max(0, game.invincible - dt);

    const level = clamp(audio.smoothed, 0, 1.2);
    const d = game.dino;
    d.bob += dt * (d.onGround ? 12 : 7);
    d.mouth = lerp(d.mouth, level > 0.06 ? clamp(level, 0, 1) : 0, 0.22);
    d.blink = Math.max(0, d.blink - dt);

    if (Math.random() < 0.006 && d.blink <= 0) {
      d.blink = 0.12;
    }

    const activeVoice = level > 0.07;
    if (activeVoice) {
      if (d.onGround) {
        d.vy = -460 - level * 260;
        d.onGround = false;
        playTone("jump");
        addParticles(d.x + 35, GROUND_Y - 10, "#ffffff", 6);
      } else {
        d.vy -= (800 + level * 680) * dt;
      }
    }

    if (level > 0.92) {
      game.overVoiceTime += dt;
      if (game.overVoiceTime > 0.7) {
        addFloatText("啊太猛了", d.x + 60, d.y - 12, "#8b5cf6");
        game.overVoiceTime = -0.2;
      }
    } else {
      game.overVoiceTime = Math.max(0, game.overVoiceTime - dt * 2);
    }

    d.vy += 1030 * dt;
    d.vy = clamp(d.vy, -780, 860);
    d.y += d.vy * dt;

    if (d.y < 74) {
      d.y = 74;
      d.vy = Math.max(90, d.vy);
      if (level > 0.75) {
        game.shake = 4;
      }
    }

    if (d.y + d.height >= GROUND_Y) {
      d.y = GROUND_Y - d.height;
      d.vy = 0;
      d.onGround = true;
    }

    game.obstacleTimer -= dt;
    if (game.obstacleTimer <= 0) {
      spawnObstacle();
      const difficulty = clamp((game.elapsed - 20) / 40, 0, 1);
      const earlyGrace = game.elapsed < 24 ? 0.35 : 0;
      game.obstacleTimer = rand(1.24, 1.92) - difficulty * 0.28 + earlyGrace;
    }

    game.rewardTimer -= dt;
    if (game.rewardTimer <= 0) {
      spawnReward();
      game.rewardTimer = rand(0.62, 1.04);
    }

    for (const obstacle of game.obstacles) {
      obstacle.x -= game.speed * dt;
      obstacle.wobble += dt * 5;
    }

    for (const reward of game.rewards) {
      reward.x -= game.speed * dt;
      reward.spin += dt * 5;
    }

    const dinoHitbox = getDinoHitbox();
    for (const obstacle of game.obstacles) {
      if (obstacle.hit) continue;
      const pad = obstacle.type === "cloud" ? 30 : obstacle.type === "balloon" ? 24 : 18;
      const hitbox = {
        x: obstacle.x + pad,
        y: obstacle.y + pad,
        width: obstacle.width - pad * 2,
        height: obstacle.height - pad * 2,
      };

      if (intersects(dinoHitbox, hitbox)) {
        damageDino(obstacle);
        if (game.mode !== "playing") return;
      }
    }

    for (const reward of game.rewards) {
      if (reward.collected) continue;
      const hitbox = {
        x: reward.x - reward.size / 2,
        y: reward.y - reward.size / 2,
        width: reward.size,
        height: reward.size,
      };
      if (intersects(dinoHitbox, hitbox)) {
        reward.collected = true;
        game.flowers += reward.type === "flower" ? 1 : 0;
        game.score += reward.type === "flower" ? 160 : reward.type === "heart" ? 220 : 80;
        if (reward.type !== "flower" && reward.type !== "heart" && Math.random() > 0.62) game.flowers += 1;
        const gainedLife = reward.type === "heart" ? addLife(reward) : false;
        addParticles(reward.x, reward.y, reward.type === "heart" ? "#ff5d72" : reward.type === "flower" ? "#f25064" : "#ffd568", 12);
        addFloatText(
          reward.type === "flower" ? "+1 小红花" : reward.type === "heart" ? (gainedLife ? "+1 生命" : "+童心") : "+零食",
          reward.x - 20,
          reward.y - 14,
          reward.type === "heart" ? "#24966f" : "#f25064"
        );
        playTone("collect");
      }
    }

    game.obstacles = game.obstacles.filter((item) => item.x + item.width > -80);
    game.rewards = game.rewards.filter((item) => item.x + item.size > -80 && !item.collected);

    for (const p of game.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt;
    }
    game.particles = game.particles.filter((p) => p.life > 0);

    for (const f of game.floatText) {
      f.life -= dt;
      f.y += f.vy * dt;
    }
    game.floatText = game.floatText.filter((f) => f.life > 0);

    if (game.elapsed >= 60) {
      endGame("victory");
    }
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, palettes.skyTop);
    sky.addColorStop(0.68, palettes.skyBottom);
    sky.addColorStop(1, "#fff6c8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    drawSun(1085, 112);
    drawBunting();
    drawCloud(130 - (game.cloudOffset * 0.2) % 1600, 118, 1.1);
    drawCloud(570 - (game.cloudOffset * 0.14) % 1600, 88, 0.72);
    drawCloud(980 - (game.cloudOffset * 0.18) % 1600, 176, 0.9);
    drawCloud(1430 - (game.cloudOffset * 0.2) % 1600, 118, 1.1);

    drawDistantPlayground();
    drawGround();
  }

  function drawSun(x, y) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#ffe283";
    ctx.beginPath();
    ctx.arc(x, y, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 226, 131, 0.65)";
    ctx.lineWidth = 8;
    for (let i = 0; i < 10; i += 1) {
      const a = (Math.PI * 2 * i) / 10;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 58, y + Math.sin(a) * 58);
      ctx.lineTo(x + Math.cos(a) * 82, y + Math.sin(a) * 82);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCloud(x, y, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
    ctx.beginPath();
    ctx.arc(0, 28, 28, 0, Math.PI * 2);
    ctx.arc(30, 12, 38, 0, Math.PI * 2);
    ctx.arc(76, 24, 30, 0, Math.PI * 2);
    ctx.arc(112, 30, 24, 0, Math.PI * 2);
    ctx.fill();
    roundedRect(-18, 27, 150, 28, 16);
    ctx.fill();
    ctx.fillStyle = "rgba(111, 165, 196, 0.15)";
    roundedRect(20, 45, 90, 8, 4);
    ctx.fill();
    ctx.restore();
  }

  function drawBunting() {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-40, 78);
    ctx.quadraticCurveTo(330, 138, 650, 74);
    ctx.quadraticCurveTo(900, 28, 1320, 92);
    ctx.stroke();

    const colors = ["#ff6b7a", "#ffd568", "#68d6b5", "#68b7ff", "#8b5cf6"];
    for (let i = 0; i < 16; i += 1) {
      const x = i * 88 - 20;
      const y = 80 + Math.sin(i * 0.9) * 26;
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 42, y + 6);
      ctx.lineTo(x + 17, y + 58);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawDistantPlayground() {
    ctx.save();
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < 8; i += 1) {
      const x = i * 180 + 20;
      const h = 60 + (i % 3) * 28;
      ctx.fillStyle = i % 2 ? "#7ed7bb" : "#8ccbf0";
      roundedRect(x, GROUND_Y - 146 - h, 110, h, 18);
      ctx.fill();
    }

    ctx.strokeStyle = "#f8d27e";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(95, GROUND_Y - 174, 76, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i += 1) {
      const a = (Math.PI * 2 * i) / 8;
      ctx.beginPath();
      ctx.moveTo(95, GROUND_Y - 174);
      ctx.lineTo(95 + Math.cos(a) * 76, GROUND_Y - 174 + Math.sin(a) * 76);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGround() {
    ctx.save();
    ctx.fillStyle = "#65c97f";
    ctx.fillRect(0, GROUND_Y, W, 28);
    ctx.fillStyle = "#35a165";
    for (let x = -20; x < W + 30; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 2);
      ctx.lineTo(x + 10, GROUND_Y - 10);
      ctx.lineTo(x + 21, GROUND_Y + 2);
      ctx.fill();
    }

    const tileW = 86;
    const colors = ["#ffcf68", "#ff8079", "#78c8ff", "#8dda7b", "#ffb057", "#c18bff"];
    const scroll = (game.distance * 22) % tileW;
    for (let x = -tileW - scroll; x < W + tileW; x += tileW) {
      const index = Math.floor((x + scroll) / tileW);
      ctx.fillStyle = colors[Math.abs(index) % colors.length];
      roundedRect(x, GROUND_Y + 24, tileW + 3, 72, 10);
      ctx.fill();
      ctx.strokeStyle = "rgba(112, 74, 38, 0.16)";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      roundedRect(x + 14, GROUND_Y + 38, 26, 8, 4);
      ctx.fill();
    }

    ctx.fillStyle = "#8c5b3a";
    ctx.fillRect(0, GROUND_Y + 96, W, H - GROUND_Y - 96);
    ctx.fillStyle = "rgba(79, 44, 27, 0.22)";
    for (let x = -20; x < W; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 96);
      ctx.lineTo(x + 18, GROUND_Y + 138);
      ctx.lineTo(x + 38, GROUND_Y + 96);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawDino() {
    const d = game.dino;
    const level = clamp(audio.smoothed, 0, 1);
    const mouth = d.mouth;
    const bob = Math.sin(d.bob) * (d.onGround ? 4 : 2);
    const run = Math.sin(d.bob * 1.5);

    ctx.save();
    ctx.translate(d.x, d.y + bob);
    if (game.invincible > 0 && Math.sin(game.invincible * 34) > 0) {
      ctx.globalAlpha = 0.52;
    }

    if (mouth > 0.08) {
      drawSoundWaves(96, 33, mouth);
    }

    ctx.fillStyle = "rgba(38, 77, 73, 0.16)";
    ctx.beginPath();
    ctx.ellipse(55, 97, 52, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#d88235";
    roundedRect(4, 34, 32, 48, 9);
    ctx.fill();
    ctx.fillStyle = "#a95828";
    roundedRect(10, 42, 19, 30, 6);
    ctx.fill();

    ctx.fillStyle = palettes.dinoDark;
    ctx.beginPath();
    ctx.moveTo(13, 67);
    ctx.quadraticCurveTo(-33, 76, -54, 54);
    ctx.quadraticCurveTo(-25, 50, 18, 46);
    ctx.fill();

    ctx.fillStyle = palettes.dino;
    ctx.beginPath();
    ctx.ellipse(44, 52, 52, 42, -0.08, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(80, 33, 42, 36, 0.05, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#43b887";
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(27 + i * 18, 8 - Math.abs(i - 1.5) * 2);
      ctx.lineTo(41 + i * 18, -14 - Math.abs(i - 1.5) * 3);
      ctx.lineTo(54 + i * 18, 11);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = "#fff7d2";
    ctx.beginPath();
    ctx.ellipse(58, 65, 27, 22, 0, 0, Math.PI * 2);
    ctx.fill();

    drawDinoLeg(30, 86, run, "#43b887");
    drawDinoLeg(76, 86, -run, "#24966f");
    drawDinoArm(50, 55, -run);

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(88, 21, 12, d.blink > 0 ? 2 : 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#18333d";
    ctx.beginPath();
    ctx.ellipse(91, 23, 5.5, d.blink > 0 ? 1 : 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(94, 17, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ff91a0";
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(74, 39, 9, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const mouthHeight = 12 + mouth * 28;
    ctx.fillStyle = "#5b2132";
    ctx.beginPath();
    ctx.ellipse(112, 46, 12 + mouth * 17, mouthHeight, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff8d91";
    ctx.beginPath();
    ctx.ellipse(113, 58 + mouth * 8, 8 + mouth * 9, 4 + mouth * 8, -0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(101 + i * 8, 30 + mouth * 3);
      ctx.lineTo(106 + i * 8, 40 + mouth * 3);
      ctx.lineTo(111 + i * 8, 30 + mouth * 3);
      ctx.closePath();
      ctx.fill();
    }

    if (level > 0.88) {
      ctx.fillStyle = "rgba(139, 92, 246, 0.9)";
      ctx.font = "900 24px ui-rounded, system-ui, sans-serif";
      ctx.fillText("啊太猛!", 14, -18);
    }

    ctx.restore();
  }

  function drawDinoLeg(x, y, phase, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(phase * 0.18);
    ctx.fillStyle = color;
    roundedRect(-8, -5, 18, 30, 8);
    ctx.fill();
    ctx.fillStyle = "#1f7e62";
    roundedRect(-7, 18, 28, 11, 6);
    ctx.fill();
    ctx.restore();
  }

  function drawDinoArm(x, y, phase) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(0.7 + phase * 0.14);
    ctx.fillStyle = "#24966f";
    roundedRect(0, -5, 28, 12, 6);
    ctx.fill();
    ctx.fillStyle = "#fff8de";
    ctx.beginPath();
    ctx.arc(28, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSoundWaves(x, y, strength) {
    const colors = ["#8b5cf6", "#58c7ff", "#65d66e", "#ffd568", "#ff6b6b"];
    ctx.save();
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    for (let i = 0; i < 5; i += 1) {
      ctx.strokeStyle = colors[i];
      ctx.globalAlpha = 0.46 + strength * 0.42;
      ctx.beginPath();
      const radius = 18 + i * 17 + strength * 8;
      ctx.arc(x + i * 7, y, radius, -0.72, 0.72);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawObstacle(obstacle) {
    ctx.save();
    if (obstacle.hit) {
      ctx.globalAlpha = 0.35;
    }
    if (obstacle.type === "notebook") drawNotebook(obstacle);
    if (obstacle.type === "alarm") drawAlarm(obstacle);
    if (obstacle.type === "sign") drawSign(obstacle);
    if (obstacle.type === "cloud") drawQuietCloud(obstacle);
    if (obstacle.type === "balloon") drawMicBalloon(obstacle);
    ctx.restore();
  }

  function drawNotebook(o) {
    ctx.save();
    ctx.translate(o.x + o.width / 2, o.y + o.height / 2 + Math.sin(o.wobble) * 3);
    ctx.rotate(Math.sin(o.wobble) * 0.05);
    ctx.fillStyle = "rgba(38, 77, 73, 0.14)";
    ctx.beginPath();
    ctx.ellipse(0, 58, 42, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffd568";
    roundedRect(-36, -50, 72, 92, 12);
    ctx.fill();
    ctx.strokeStyle = "#b8812d";
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = "#9f7341";
    for (let i = 0; i < 4; i += 1) {
      roundedRect(-44, -36 + i * 18, 16, 8, 4);
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(136, 92, 48, 0.38)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-16, -22 + i * 16);
      ctx.lineTo(20, -22 + i * 16);
      ctx.stroke();
    }

    drawAngryFace(-9, -10, 1);
    drawStickArm(-42, -4, -1);
    drawStickArm(42, -4, 1);
    drawLittleFeet(-18, 44);
    drawLittleFeet(20, 44);
    ctx.restore();
  }

  function drawAlarm(o) {
    ctx.save();
    ctx.translate(o.x + o.width / 2, o.y + o.height / 2 + Math.sin(o.wobble) * 4);
    ctx.rotate(Math.sin(o.wobble * 1.5) * 0.06);
    ctx.fillStyle = "rgba(38, 77, 73, 0.14)";
    ctx.beginPath();
    ctx.ellipse(0, 48, 42, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ff6b6b";
    ctx.beginPath();
    ctx.arc(0, 0, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#bb394a";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = "#ffd568";
    ctx.beginPath();
    ctx.arc(-24, -39, 15, 0, Math.PI * 2);
    ctx.arc(24, -39, 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff8de";
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
    ctx.fill();
    drawAngryFace(-8, -1, 0.84);

    ctx.strokeStyle = "#20303a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -18);
    ctx.moveTo(0, 0);
    ctx.lineTo(15, 8);
    ctx.stroke();
    drawLittleFeet(-18, 34);
    drawLittleFeet(18, 34);
    ctx.restore();
  }

  function drawSign(o) {
    ctx.save();
    ctx.translate(o.x + o.width / 2, o.y);
    ctx.fillStyle = "#80563b";
    roundedRect(-5, 46, 10, 72, 4);
    ctx.fill();
    ctx.fillStyle = "#ff9f2e";
    roundedRect(-36, 0, 72, 48, 10);
    ctx.fill();
    ctx.strokeStyle = "#b55d25";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = "#fff8de";
    ctx.font = "900 20px ui-rounded, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("KPI", 0, 31);
    ctx.fillStyle = "rgba(38, 77, 73, 0.14)";
    ctx.beginPath();
    ctx.ellipse(0, 120, 38, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawQuietCloud(o) {
    ctx.save();
    ctx.translate(o.x + o.width / 2, o.y + o.height / 2 + Math.sin(o.wobble) * 7);
    ctx.fillStyle = "rgba(38, 77, 73, 0.12)";
    ctx.beginPath();
    ctx.ellipse(0, 46, 56, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(-40, 10, 27, 0, Math.PI * 2);
    ctx.arc(-14, -8, 38, 0, Math.PI * 2);
    ctx.arc(28, 0, 32, 0, Math.PI * 2);
    ctx.arc(55, 14, 24, 0, Math.PI * 2);
    ctx.fill();
    roundedRect(-62, 8, 132, 36, 18);
    ctx.fill();
    ctx.fillStyle = "#6b8790";
    ctx.font = "900 24px ui-rounded, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("嘘", 4, 24);
    ctx.restore();
  }

  function drawMicBalloon(o) {
    ctx.save();
    ctx.translate(o.x + o.width / 2, o.y + 46 + Math.sin(o.wobble) * 6);
    ctx.fillStyle = "#8b5cf6";
    ctx.beginPath();
    ctx.ellipse(0, 0, 34, 44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(12, -16, 8, 12, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff8de";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-13, -9);
    ctx.lineTo(13, 17);
    ctx.moveTo(13, -9);
    ctx.lineTo(-13, 17);
    ctx.stroke();
    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 44);
    ctx.bezierCurveTo(-20, 72, 16, 88, -3, 114);
    ctx.stroke();
    ctx.restore();
  }

  function drawAngryFace(x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.strokeStyle = "#20303a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-18, -10);
    ctx.lineTo(-5, -4);
    ctx.moveTo(12, -4);
    ctx.lineTo(25, -12);
    ctx.stroke();
    ctx.fillStyle = "#20303a";
    ctx.beginPath();
    ctx.arc(-10, 4, 4, 0, Math.PI * 2);
    ctx.arc(18, 4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6b1f35";
    ctx.beginPath();
    ctx.ellipse(4, 24, 14, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawStickArm(x, y, direction) {
    ctx.strokeStyle = "#8b5b2f";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + direction * 24, y - 12);
    ctx.stroke();
  }

  function drawLittleFeet(x, y) {
    ctx.fillStyle = "#20303a";
    roundedRect(x - 13, y, 25, 10, 5);
    ctx.fill();
  }

  function drawReward(reward) {
    ctx.save();
    ctx.translate(reward.x, reward.y + Math.sin(reward.spin) * 4);
    ctx.rotate(Math.sin(reward.spin * 0.6) * 0.12);
    if (reward.type === "flower") drawFlower();
    if (reward.type === "lollipop") drawLollipop();
    if (reward.type === "marble") drawMarble();
    if (reward.type === "console") drawConsole();
    if (reward.type === "snack") drawSnack();
    if (reward.type === "heart") drawHeartReward();
    ctx.restore();
  }

  function drawFlower() {
    ctx.fillStyle = "#ffd568";
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f25064";
    for (let i = 0; i < 6; i += 1) {
      const a = (Math.PI * 2 * i) / 6;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 17, Math.sin(a) * 17, 10, 15, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffd568";
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLollipop() {
    ctx.strokeStyle = "#fff8de";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(9, 18);
    ctx.lineTo(20, 42);
    ctx.stroke();
    ctx.fillStyle = "#ff7fb0";
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff8de";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0.1, Math.PI * 1.5);
    ctx.stroke();
  }

  function drawMarble() {
    ctx.fillStyle = "#68b7ff";
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.48)";
    ctx.beginPath();
    ctx.arc(-7, -8, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(3, 4, 13, -0.8, 1.8);
    ctx.stroke();
  }

  function drawConsole() {
    ctx.fillStyle = "#fff1bb";
    roundedRect(-27, -22, 54, 44, 9);
    ctx.fill();
    ctx.strokeStyle = "#dd9950";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = "#9ddf7c";
    roundedRect(-8, -14, 24, 16, 3);
    ctx.fill();
    ctx.fillStyle = "#20303a";
    ctx.fillRect(-20, 3, 6, 18);
    ctx.fillRect(-26, 9, 18, 6);
    ctx.fillStyle = "#f25064";
    ctx.beginPath();
    ctx.arc(16, 11, 4, 0, Math.PI * 2);
    ctx.arc(25, 3, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSnack() {
    ctx.fillStyle = "#f25064";
    roundedRect(-12, -28, 24, 56, 7);
    ctx.fill();
    ctx.fillStyle = "#ffd568";
    roundedRect(-7, -20, 14, 30, 5);
    ctx.fill();
    ctx.fillStyle = "#fff8de";
    ctx.fillRect(-9, -24, 18, 5);
    ctx.fillRect(-9, 20, 18, 5);
  }

  function drawHeartReward() {
    ctx.save();
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = "#ff5d72";
    roundedRect(-13, -12, 28, 28, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(1, -13, 14, 0, Math.PI * 2);
    ctx.arc(15, 1, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(-5, -11, 5, 8, -0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawParticles() {
    for (const p of game.particles) {
      ctx.save();
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const f of game.floatText) {
      ctx.save();
      ctx.globalAlpha = clamp(f.life / 0.8, 0, 1);
      ctx.fillStyle = f.color;
      ctx.font = "900 24px ui-rounded, system-ui, sans-serif";
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 5;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  function drawGame() {
    ctx.save();
    if (game.shake > 0) {
      ctx.translate(rand(-game.shake, game.shake), rand(-game.shake, game.shake));
    }
    drawBackground();

    for (const reward of game.rewards) {
      drawReward(reward);
    }

    for (const obstacle of game.obstacles) {
      drawObstacle(obstacle);
    }

    if (game.dino) drawDino();
    drawParticles();

    if (game.mode !== "playing") {
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  function loop(time) {
    const dt = Math.min(0.033, (time - game.lastTime) / 1000 || 0);
    game.lastTime = time;
    updateAudio();
    updateGame(dt);
    drawGame();
    updateHud();
    requestAnimationFrame(loop);
  }

  buttons.start.addEventListener("click", startWithMic);
  buttons.demo.addEventListener("click", startDemo);
  buttons.retry.addEventListener("click", startWithMic);
  buttons.fallback.addEventListener("click", startDemo);
  buttons.restart.addEventListener("click", () => {
    if (audio.micReady) {
      startGame();
    } else {
      startDemo();
    }
  });
  buttons.fullscreen.addEventListener("click", async () => {
    const stage = document.querySelector(".stage");
    if (!document.fullscreenElement && stage.requestFullscreen) {
      await stage.requestFullscreen();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      audio.keyboardDown = true;
      event.preventDefault();
      if (game.mode === "start") startDemo();
    }
    if (event.code === "Enter" && game.mode === "result") {
      if (audio.micReady) startGame();
      else startDemo();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      audio.keyboardDown = false;
      event.preventDefault();
    }
  });

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    buttons.start.disabled = true;
    buttons.start.textContent = "麦克风不可用";
  }

  game.dino = makeDino();
  drawGame();
  requestAnimationFrame(loop);
})();
