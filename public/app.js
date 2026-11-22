(() => {
  const params = new URLSearchParams(window.location.search);
  const isOverlay = params.get('overlay') === '1' || params.get('obs') === '1';
  if (isOverlay) document.body.classList.add('obs-mode');

  // ==================== STADIUM WEBAUDIO ENGINE ====================
  const SoundEngine = {
    ctx: null,
    muted: false,
    master: null,
    reverbIn: null,

    ensureCtx() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
          const comp = this.ctx.createDynamicsCompressor();
          comp.threshold.value = -16;
          comp.ratio.value = 3.5;
          const master = this.ctx.createGain();
          master.gain.value = 0.88;
          master.connect(comp);
          comp.connect(this.ctx.destination);

          const len = Math.floor(this.ctx.sampleRate * 1.8);
          const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
          for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
          }
          const conv = this.ctx.createConvolver();
          conv.buffer = buf;
          const wet = this.ctx.createGain();
          wet.gain.value = 0.28;
          conv.connect(wet);
          wet.connect(master);
          this.master = master;
          this.reverbIn = conv;
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    },

    tone(freq, dur, opts = {}) {
      if (this.muted) return;
      const ctx = this.ensureCtx();
      if (!ctx || !this.master) return;
      const { type = 'sine', vol = 0.08, delay = 0, glide = null, wet = true } = opts;
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(this.master);
      if (wet && this.reverbIn) g.connect(this.reverbIn);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    },

    noise(dur, vol = 0.04, delay = 0) {
      if (this.muted) return;
      const ctx = this.ensureCtx();
      if (!ctx || !this.master) return;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1400;
      const g = ctx.createGain();
      const t = ctx.currentTime + delay;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      if (this.reverbIn) g.connect(this.reverbIn);
      src.start(t);
      src.stop(t + dur + 0.05);
    },

    playWhistle() {
      this.tone(2650, 0.22, { vol: 0.045, glide: 2800 });
    },

    playKick() {
      this.tone(135, 0.18, { vol: 0.22, glide: 48, wet: false });
    },

    playGoal() {
      this.noise(1.7, 0.05, 0.05);
      [[392, 0], [523.25, 0.1], [659.25, 0.2], [783.99, 0.34], [1046.5, 0.42]].forEach(([f, d]) => {
        this.tone(f, 0.9, { type: 'triangle', delay: d, vol: 0.08 });
      });
    },

    playSave() {
      this.tone(160, 0.14, { vol: 0.14, glide: 80, wet: false });
      this.tone(320, 0.28, { type: 'triangle', delay: 0.08, vol: 0.075, glide: 210 });
    }
  };

  window.addEventListener('pointerdown', () => SoundEngine.ensureCtx(), { once: true });
  window.addEventListener('keydown', () => SoundEngine.ensureCtx(), { once: true });

  // ==================== DOM ====================
  const el = {
    stage: document.getElementById('stage9x16'),
    goalsTotal: document.getElementById('goalsTotal'),
    savesTotal: document.getElementById('savesTotal'),
    kickerCard: document.getElementById('kickerCard'),
    kickerName: document.getElementById('kickerName'),
    kickerZone: document.getElementById('kickerZone'),
    energyLbl: document.getElementById('energyLbl'),
    energyFill: document.getElementById('energyFill'),
    canvas: document.getElementById('stadiumCanvas'),
    resultBanner: document.getElementById('resultBanner'),
    queueItems: document.getElementById('queueItems'),
    feedStrip: document.getElementById('feedStrip'),
    liveBadge: document.getElementById('liveBadge'),
    lbList: document.getElementById('lbList'),
    // Host Panel
    connChip: document.getElementById('connChip'),
    btnKickNow: document.getElementById('btnKickNow'),
    btnToggleBots: document.getElementById('btnToggleBots'),
    btnMute: document.getElementById('btnMute'),
    btnTestGoal: document.getElementById('btnTestGoal'),
    btnReset: document.getElementById('btnReset'),
    tiktokInput: document.getElementById('tiktokInput'),
    btnConnect: document.getElementById('btnConnect'),
    btnDisconnect: document.getElementById('btnDisconnect'),
    tiktokStatus: document.getElementById('tiktokStatus'),
    btnTestVip: document.getElementById('btnTestVip'),
    obsUrlInput: document.getElementById('obsUrlInput'),
    btnCopyUrl: document.getElementById('btnCopyUrl')
  };

  if (el.obsUrlInput) {
    el.obsUrlInput.value = `${window.location.origin}${window.location.pathname}?overlay=1`;
  }

  let latestState = null;
  let kickAnimProgress = 0; // 0..1 during kick
  let netRipple = 0;
  const confetti = [];
  const sparks = [];

  function spawnGoalConfetti() {
    const cols = ['#4ade80', '#f5c542', '#38bdf8', '#ffffff', '#f43f5e'];
    for (let i = 0; i < 60; i++) {
      confetti.push({
        x: Math.random(),
        y: -0.05 - Math.random() * 0.2,
        vx: (Math.random() - 0.5) * 0.22,
        vy: 0.35 + Math.random() * 0.45,
        size: 5 + Math.random() * 6,
        color: cols[i % cols.length],
        life: 1
      });
    }
  }

  // ==================== SOCKET.IO ====================
  const socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    if (el.connChip) el.connChip.textContent = 'Canlı Qoşuldu';
  });

  socket.on('tiktok-status', (st) => {
    if (el.tiktokStatus) {
      el.tiktokStatus.textContent = st.connected
        ? `🟢 @${st.username} • ${st.viewerCount || 0} izləyici`
        : st.connecting
          ? `⏳ @${st.username} qoşulur...`
          : `⚪ ${st.error || 'Qoşulmayıb'}`;
    }
    if (el.liveBadge) {
      el.liveBadge.textContent = st.connected
        ? `🔴 @${st.username} • ${st.viewerCount || 0}`
        : '● CANLI HAZIR';
    }
  });

  socket.on('penalty-fx', (fx) => {
    if (!SoundEngine.muted) SoundEngine.ensureCtx();
    if (fx.type === 'whistle') {
      SoundEngine.playWhistle();
    } else if (fx.type === 'kick') {
      SoundEngine.playKick();
      kickAnimProgress = 0;
    } else if (fx.type === 'goal') {
      SoundEngine.playGoal();
      netRipple = 1;
      spawnGoalConfetti();
    } else if (fx.type === 'save') {
      SoundEngine.playSave();
    }
  });

  socket.on('penalty-state', (state) => {
    latestState = state;
    if (state.soundMuted !== undefined) SoundEngine.muted = !!state.soundMuted;
    if (!SoundEngine.muted) SoundEngine.ensureCtx();

    if (el.stage && state.theme) el.stage.dataset.theme = state.theme;
    document.querySelectorAll('.theme-btn').forEach((b) => b.classList.toggle('active', b.dataset.theme === state.theme));
    document.querySelectorAll('.diff-btn').forEach((b) => b.classList.toggle('active', b.dataset.diff === state.difficulty));

    if (el.goalsTotal) el.goalsTotal.textContent = state.goalsTotal || 0;
    if (el.savesTotal) el.savesTotal.textContent = state.savesTotal || 0;

    const shot = state.currentShot;
    const zoneNames = { 1: '1 • SOL', 2: '2 • ORTA', 3: '3 • SAĞ' };
    if (el.kickerName) el.kickerName.textContent = shot ? `${shot.isSuper ? '👑 ' : ''}${shot.nickname}` : 'Gözlənilir...';
    if (el.kickerZone) el.kickerZone.textContent = shot ? (zoneNames[shot.zone] || '—') : 'ZONA —';
    if (el.kickerCard) el.kickerCard.classList.toggle('is-super', !!(shot && shot.isSuper));

    [1, 2, 3].forEach((z) => {
      const card = document.getElementById(`zoneBtn${z}`);
      if (card) card.classList.toggle('active', !!(shot && shot.zone === z));
    });

    if (el.energyLbl) {
      el.energyLbl.textContent = state.nextShotSuper
        ? '⚡ NÖVBƏTİ ZƏRBƏ: SUPER ŞUT!'
        : `🔥 SUPER ŞUT: ${Math.min(100, state.likeEnergy || 0)}%`;
    }
    if (el.energyFill) el.energyFill.style.width = `${state.nextShotSuper ? 100 : Math.min(100, state.likeEnergy || 0)}%`;

    if (el.resultBanner) {
      if (state.phase === 'result' && shot) {
        el.resultBanner.classList.remove('hidden', 'goal', 'saved');
        if (shot.outcome === 'goal') {
          el.resultBanner.classList.add('goal');
          el.resultBanner.textContent = shot.isSuper ? '⚡ SUPER QOOOL!!' : '⚽ QOOOL!!';
        } else {
          el.resultBanner.classList.add('saved');
          el.resultBanner.textContent = '🧤 TUTDU!!';
        }
      } else {
        el.resultBanner.classList.add('hidden');
      }
    }

    if (el.queueItems) {
      const q = state.queue || [];
      el.queueItems.textContent = q.length > 0
        ? q.map((item) => `${item.isSuper ? '👑' : ''}${item.nickname}(${item.zone})`).join(' • ')
        : 'Çatda 1, 2 və ya 3 yaz!';
    }

    if (el.feedStrip && Array.isArray(state.feed) && state.feed.length > 0) {
      el.feedStrip.innerHTML = `<span>${escapeHtml(state.feed[0].text)}</span>`;
    }

    if (el.lbList) {
      const lb = state.leaderboard || [];
      if (lb.length === 0) {
        el.lbList.innerHTML = '<div class="lb-empty">İlk qoldan sonra siyahı açılacaq</div>';
      } else {
        el.lbList.innerHTML = lb.slice(0, 3).map((p, idx) => {
          const m = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
          return `<div class="lb-row"><span>${m} ${escapeHtml(p.nickname)}</span><span>⚽ ${p.goals} • ${p.score} xal</span></div>`;
        }).join('');
      }
    }

    if (el.btnToggleBots) el.btnToggleBots.textContent = state.autoBotShots ? '🤖 Botlar: AÇIQ' : '🤖 Botlar: BAĞLI';
    if (el.btnMute) el.btnMute.textContent = state.soundMuted ? '🔇 Səs Bağlıdır' : '🔊 Səs Açıqdır';
  });

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ==================== 60 FPS STADIUM RENDERER ====================
  let lastT = performance.now();
  function renderLoop(now) {
    requestAnimationFrame(renderLoop);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    const canvas = el.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 1. Night Sky & Stadium Stands
    const horizon = h * 0.34;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#040a1d');
    sky.addColorStop(1, '#0f2247');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);

    // Floodlight cones
    [w * 0.16, w * 0.84].forEach((lx) => {
      const beam = ctx.createRadialGradient(lx, h * 0.04, 4, lx, h * 0.04, w * 0.55);
      beam.addColorStop(0, 'rgba(255, 250, 220, 0.35)');
      beam.addColorStop(1, 'rgba(255, 250, 220, 0)');
      ctx.fillStyle = beam;
      ctx.fillRect(0, 0, w, h * 0.65);
    });

    // Stadium crowd silhouette strip
    ctx.fillStyle = '#091128';
    ctx.fillRect(0, horizon - h * 0.11, w, h * 0.11);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    for (let x = 10; x < w; x += 14) {
      for (let y = horizon - h * 0.095; y < horizon - 6; y += 11) {
        ctx.fillRect(x + ((y * 3) % 5), y, 3, 3);
      }
    }

    // 2. Green Pitch with Perspective Stripes
    const pitch = ctx.createLinearGradient(0, horizon, 0, h);
    pitch.addColorStop(0, '#14532d');
    pitch.addColorStop(0.5, '#15803d');
    pitch.addColorStop(1, '#166534');
    ctx.fillStyle = pitch;
    ctx.fillRect(0, horizon, w, h - horizon);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
    for (let i = 0; i < 6; i += 2) {
      const y1 = horizon + (h - horizon) * (i / 6);
      const y2 = horizon + (h - horizon) * ((i + 1) / 6);
      ctx.fillRect(0, y1, w, y2 - y1);
    }

    // Penalty Box Lines
    const goalW = w * 0.78;
    const goalH = h * 0.28;
    const goalX = (w - goalW) * 0.5;
    const goalY = horizon - goalH * 0.45;
    const goalBottom = goalY + goalH;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.beginPath();
    ctx.moveTo(w * 0.08, goalBottom + h * 0.24);
    ctx.lineTo(w * 0.16, goalBottom);
    ctx.moveTo(w * 0.92, goalBottom + h * 0.24);
    ctx.lineTo(w * 0.84, goalBottom);
    ctx.moveTo(w * 0.08, goalBottom + h * 0.24);
    ctx.lineTo(w * 0.92, goalBottom + h * 0.24);
    ctx.stroke();

    // Penalty spot
    const spotX = w * 0.5;
    const spotY = h * 0.84;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(spotX, spotY, w * 0.018, w * 0.008, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. Goalpost + Netting
    if (netRipple > 0) netRipple = Math.max(0, netRipple - dt * 1.4);
    const bulge = Math.sin(now * 0.04) * netRipple * 10;

    // Net interior shade
    ctx.fillStyle = 'rgba(2, 6, 23, 0.48)';
    ctx.fillRect(goalX, goalY, goalW, goalH);

    // Net grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    for (let x = goalX + 14; x < goalX + goalW; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, goalY);
      ctx.quadraticCurveTo(x + bulge, (goalY + goalBottom) * 0.5, x, goalBottom);
      ctx.stroke();
    }
    for (let y = goalY + 14; y < goalBottom; y += 16) {
      ctx.beginPath();
      ctx.moveTo(goalX, y);
      ctx.quadraticCurveTo(w * 0.5, y + bulge * 0.7, goalX + goalW, y);
      ctx.stroke();
    }

    // 3 Target Zone Badges inside Goal (1, 2, 3)
    const state = latestState;
    const shot = state && state.currentShot;
    const targetXs = { 1: goalX + goalW * 0.16, 2: goalX + goalW * 0.5, 3: goalX + goalW * 0.84 };
    const targetYs = { 1: goalY + goalH * 0.46, 2: goalY + goalH * 0.19, 3: goalY + goalH * 0.46 };

    [1, 2, 3].forEach((z) => {
      const isSelected = shot && shot.zone === z;
      ctx.save();
      ctx.beginPath();
      ctx.arc(targetXs[z], targetYs[z], w * 0.055, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? 'rgba(245, 197, 66, 0.35)' : 'rgba(15, 23, 42, 0.5)';
      ctx.fill();
      ctx.lineWidth = isSelected ? 3 : 1.5;
      ctx.strokeStyle = isSelected ? '#facc15' : 'rgba(255, 255, 255, 0.35)';
      ctx.stroke();
      ctx.fillStyle = isSelected ? '#fef08a' : 'rgba(255, 255, 255, 0.8)';
      ctx.font = `900 ${Math.round(w * 0.05)}px Montserrat, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(z), targetXs[z], targetYs[z] + 1);
      ctx.restore();
    });

    // White Goal Frame
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = Math.max(5, w * 0.016);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(goalX, goalBottom);
    ctx.lineTo(goalX, goalY);
    ctx.lineTo(goalX + goalW, goalY);
    ctx.lineTo(goalX + goalW, goalBottom);
    ctx.stroke();

    // 4. Compute Animations for Kick & Keeper
    if (state && state.phase === 'kick') {
      kickAnimProgress = Math.min(1, kickAnimProgress + dt / 0.82);
    } else if (state && state.phase === 'result') {
      kickAnimProgress = 1;
    } else {
      kickAnimProgress = 0;
    }

    // Keeper position & tilt
    let keeperX = w * 0.5;
    let keeperY = goalBottom - h * 0.075;
    let keeperTilt = 0;
    if (state && (state.phase === 'kick' || state.phase === 'result') && shot) {
      const diveT = Math.min(1, kickAnimProgress * 1.2);
      const ease = 1 - Math.pow(1 - diveT, 3);
      const destX = shot.keeperZone === 1 ? goalX + goalW * 0.18 : shot.keeperZone === 3 ? goalX + goalW * 0.82 : w * 0.5;
      keeperX = w * 0.5 + (destX - w * 0.5) * ease;
      keeperY = (goalBottom - h * 0.075) - Math.sin(ease * Math.PI) * (h * 0.045);
      keeperTilt = (shot.keeperZone === 1 ? -0.65 : shot.keeperZone === 3 ? 0.65 : 0) * ease;
    } else {
      keeperX = w * 0.5 + Math.sin(now * 0.005) * (goalW * 0.05);
    }

    // Draw Goalkeeper
    ctx.save();
    ctx.translate(keeperX, keeperY);
    ctx.rotate(keeperTilt);
    const gkScale = w / 420;
    ctx.scale(gkScale, gkScale);
    // Jersey
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.roundRect(-16, -22, 32, 34, 8);
    ctx.fill();
    // Shorts/legs
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-13, 12, 10, 18);
    ctx.fillRect(3, 12, 10, 18);
    // Arms + Gloves
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-14, -14);
    ctx.lineTo(-32, -26);
    ctx.moveTo(14, -14);
    ctx.lineTo(32, -26);
    ctx.stroke();
    ctx.fillStyle = '#a3e635';
    ctx.beginPath();
    ctx.arc(-34, -27, 7, 0, Math.PI * 2);
    ctx.arc(34, -27, 7, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.fillStyle = '#fed7aa';
    ctx.beginPath();
    ctx.arc(0, -34, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 5. Soccer Ball
    let ballX = spotX;
    let ballY = spotY;
    let ballScale = 1;
    const isSuper = !!(shot && shot.isSuper);
    if (state && (state.phase === 'kick' || state.phase === 'result') && shot) {
      const t = kickAnimProgress;
      const ease = 1 - Math.pow(1 - t, 2.2);
      const endX = targetXs[shot.zone] || w * 0.5;
      const endY = shot.outcome === 'saved' ? keeperY - 8 : (targetYs[shot.zone] || targetYs[2]) + 6;
      ballX = spotX + (endX - spotX) * ease;
      ballY = spotY + (endY - spotY) * ease - Math.sin(t * Math.PI) * (h * 0.08);
      ballScale = 1 - ease * 0.45;
      if (t > 0.1 && t < 0.95 && isSuper) {
        sparks.push({ x: ballX, y: ballY, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 1 });
      }
    }

    // Ball shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(ballX, ballY + 14 * ballScale, 15 * ballScale, 6 * ballScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Super Sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
      const sp = sparks[i];
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.life -= dt * 2.5;
      if (sp.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = sp.life;
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Ball body
    const br = Math.max(10, w * 0.044) * ballScale;
    ctx.save();
    ctx.translate(ballX, ballY);
    if (isSuper) {
      ctx.shadowColor = '#facc15';
      ctx.shadowBlur = 18;
    }
    ctx.beginPath();
    ctx.arc(0, 0, br, 0, Math.PI * 2);
    ctx.fillStyle = isSuper ? '#fde047' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();
    // Classic pentagon dots
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(0, 0, br * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 6. Goal Confetti
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.life -= dt * 0.35;
      if (c.life <= 0 || c.y > 1.05) { confetti.splice(i, 1); continue; }
      ctx.fillStyle = c.color;
      ctx.fillRect(c.x * w, c.y * h, c.size, c.size * 1.3);
    }
  }
  requestAnimationFrame(renderLoop);

  // ==================== HOST CONTROLS ====================
  if (el.btnKickNow) el.btnKickNow.addEventListener('click', () => socket.emit('kick-now'));
  if (el.btnToggleBots) {
    el.btnToggleBots.addEventListener('click', () => {
      socket.emit('toggle-bots', { enabled: !(latestState && latestState.autoBotShots) });
    });
  }
  document.querySelectorAll('.diff-btn').forEach((b) => {
    b.addEventListener('click', () => socket.emit('set-difficulty', { difficulty: b.dataset.diff }));
  });
  document.querySelectorAll('.theme-btn').forEach((b) => {
    b.addEventListener('click', () => socket.emit('set-theme', { theme: b.dataset.theme }));
  });
  if (el.btnMute) {
    el.btnMute.addEventListener('click', () => {
      SoundEngine.muted = !SoundEngine.muted;
      socket.emit('toggle-sound', { muted: SoundEngine.muted });
    });
  }
  if (el.btnTestGoal) el.btnTestGoal.addEventListener('click', () => { SoundEngine.ensureCtx(); SoundEngine.playGoal(); });
  if (el.btnReset) el.btnReset.addEventListener('click', () => socket.emit('reset-scores'));
  if (el.btnConnect) el.btnConnect.addEventListener('click', () => socket.emit('connect-tiktok', { username: el.tiktokInput.value.trim() }));
  if (el.btnDisconnect) el.btnDisconnect.addEventListener('click', () => socket.emit('disconnect-tiktok'));
  document.querySelectorAll('[data-test-zone]').forEach((b) => {
    b.addEventListener('click', () => socket.emit('manual-kick', { nickname: 'Aparıcı_Test', zone: Number(b.dataset.testZone) }));
  });
  if (el.btnTestVip) {
    el.btnTestVip.addEventListener('click', () => socket.emit('manual-kick', { nickname: 'VIP_Test', zone: 1 + Math.floor(Math.random() * 3), isVip: true }));
  }
  if (el.btnCopyUrl && el.obsUrlInput) {
    el.btnCopyUrl.addEventListener('click', () => {
      navigator.clipboard?.writeText(el.obsUrlInput.value).catch(() => {});
      el.btnCopyUrl.textContent = '✅ Kopyalandı!';
      setTimeout(() => { el.btnCopyUrl.textContent = '📋 Kopyala'; }, 1500);
    });
  }
})();
