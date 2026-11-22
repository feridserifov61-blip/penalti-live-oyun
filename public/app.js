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

    const qTitle = document.getElementById('queueTitle');
    if (qTitle) qTitle.textContent = `⏳ NÖVBƏ (${state.queueCount || 0}):`;
    if (el.queueItems) {
      const q = state.queue || [];
      el.queueItems.textContent = q.length > 0
        ? q.map((item) => `${item.isSuper ? '👑' : ''}${item.nickname}(${item.zone})`).join(' • ')
        : 'Çatda "a" (və ya 1, 2, 3) yaz — sıraya gir!';
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

  // ==================== 60 FPS HIGH-EFFECT 3D STADIUM RENDERER ====================
  let lastT = performance.now();
  let screenShake = 0;
  let flashAlpha = 0;
  let ballSpin = 0;
  const ballTrail = [];
  const turfParticles = [];

  function spawnTurfBurst(x, y, count = 14) {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI * 0.15 - Math.random() * Math.PI * 0.7;
      const sp = 55 + Math.random() * 140;
      turfParticles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        col: Math.random() < 0.65 ? '#4ade80' : '#f8fafc'
      });
    }
  }

  function drawProGoalkeeper(ctx, x, y, sc, now, phase, diveDir, diveT, outcome) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc, sc);

    // Dynamic ground shadow
    ctx.save();
    ctx.globalAlpha = Math.max(0.18, 0.48 - diveT * 0.22);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 44, 24 + diveT * 18, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const breathe = Math.sin(now * 0.0075) * 1.8;
    const bounceX = phase === 'aim' ? Math.sin(now * 0.011) * 1.5 : 0;
    const isDiving = (phase === 'kick' || phase === 'result') && diveDir !== 0;
    const bodyTilt = isDiving ? diveDir * 1.18 * diveT : Math.sin(now * 0.005) * 0.035;
    ctx.translate(bounceX, 0);
    ctx.rotate(bodyTilt);

    // Athletic Legs (wide ready crouch in aim; full aerodynamic stretch in dive)
    const legSpread = isDiving ? 7 : 12.5;
    const kneeBend = isDiving ? 5 * diveT : 3.5 + Math.abs(breathe) * 0.7;
    [-1, 1].forEach((side) => {
      const hipX = side * 7.5;
      const hipY = 10;
      const kneeX = side * (legSpread + (isDiving ? -side * 5 : 3.5));
      const kneeY = 25 - (isDiving && side !== diveDir ? 9 * diveT : 0);
      const footX = side * (legSpread + (isDiving ? -diveDir * 4 * diveT : 0));
      const footY = 41 - kneeBend;

      // Muscular thigh + navy shorts
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 9.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.lineTo(kneeX, kneeY);
      ctx.stroke();

      // Knee skin highlight
      ctx.fillStyle = '#e6a674';
      ctx.beginPath();
      ctx.arc(kneeX, kneeY, 3.6, 0, Math.PI * 2);
      ctx.fill();

      // Pro high sock (neon orange + twin dark rings)
      ctx.strokeStyle = '#fb923c';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(kneeX, kneeY + 1);
      ctx.lineTo(footX, footY);
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(kneeX - 3, kneeY + 3, 6, 2);

      // Detailed football cleat + studs
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.ellipse(footX + side * 3.5, footY + 2, 8, 3.8, side * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(footX + side * 1, footY + 0.5, 5, 1.5);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(footX - 3, footY + 4.2, 9, 2);
    });

    // Shorts waist + athletic hip trim
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(-14, 5, 28, 11, 4);
    ctx.fill();

    // Sculpted Athletic V-Torso (3D shaded Goalkeeper Kit)
    const jerseyGrad = ctx.createLinearGradient(-19, -24, 19, 10);
    jerseyGrad.addColorStop(0, '#fb923c');
    jerseyGrad.addColorStop(0.45, '#ea580c');
    jerseyGrad.addColorStop(1, '#7c2d12');
    ctx.fillStyle = jerseyGrad;
    ctx.beginPath();
    ctx.moveTo(-19, -22 + breathe * 0.4);
    ctx.quadraticCurveTo(0, -25 + breathe * 0.4, 19, -22 + breathe * 0.4);
    ctx.lineTo(14.5, -4);
    ctx.lineTo(13, 9);
    ctx.lineTo(-13, 9);
    ctx.lineTo(-14.5, -4);
    ctx.closePath();
    ctx.fill();

    // Jersey shoulder trim, V-neck collar & #1
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-17, -21 + breathe * 0.4);
    ctx.lineTo(-13, 8);
    ctx.moveTo(17, -21 + breathe * 0.4);
    ctx.lineTo(13, 8);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(-6, -23 + breathe * 0.4);
    ctx.lineTo(0, -16 + breathe * 0.4);
    ctx.lineTo(6, -23 + breathe * 0.4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '900 12px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('1', 0, -6 + breathe * 0.3);

    // Articulated Arms + Multi-detail Pro Goalkeeper Gloves
    [-1, 1].forEach((side) => {
      const shX = side * 17.5;
      const shY = -19 + breathe * 0.4;
      let elX, elY, handX, handY;
      if (isDiving) {
        elX = shX + diveDir * 14 + side * 5;
        elY = shY - 19 * diveT;
        handX = elX + diveDir * 13;
        handY = elY - 14 * diveT;
      } else if (phase === 'result' && outcome === 'saved') {
        elX = side * 23;
        elY = -14;
        handX = side * 14;
        handY = -27;
      } else {
        elX = side * 26;
        elY = -7 + breathe * 0.9;
        handX = side * 22;
        handY = -19 + breathe * 1.1;
      }

      // Upper & lower sleeved arm
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 7.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(shX, shY);
      ctx.lineTo(elX, elY);
      ctx.lineTo(handX, handY);
      ctx.stroke();

      // Wrist bandage strap
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(handX, handY, 4.6, 0, Math.PI * 2);
      ctx.fill();

      // Pro Latex Goalkeeper Glove (white palm + lime cuff + thumb)
      ctx.save();
      ctx.translate(handX, handY - 3);
      ctx.rotate(bodyTilt * -0.45 + (isDiving ? 0 : side * -0.15));
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#65a30d';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(-6.5, -9, 13, 14, 5);
      ctx.fill();
      ctx.stroke();
      // Lime backhand accent + thumb
      ctx.fillStyle = '#a3e635';
      ctx.fillRect(-5, 1, 10, 4);
      ctx.beginPath();
      ctx.ellipse(-side * 6.5, -1, 2.8, 4.2, side * 0.3, 0, Math.PI * 2);
      ctx.fill();
      // Finger seams
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-2, -9); ctx.lineTo(-2, -3);
      ctx.moveTo(2, -9); ctx.lineTo(2, -3);
      ctx.stroke();
      ctx.restore();
    });

    // Neck + Proportional Realistic Head + Hair + Focused Face
    ctx.fillStyle = '#e59a64';
    ctx.fillRect(-3.6, -28 + breathe * 0.3, 7.2, 7);
    const headY = -34.5 + breathe * 0.3;

    // Ears
    ctx.fillStyle = '#dfa070';
    ctx.beginPath();
    ctx.arc(-9.2, headY + 0.5, 2.2, 0, Math.PI * 2);
    ctx.arc(9.2, headY + 0.5, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Sculpted Head & Jawline
    const headGrad = ctx.createRadialGradient(-2.5, headY - 3, 1.5, 0, headY, 10);
    headGrad.addColorStop(0, '#fed7aa');
    headGrad.addColorStop(1, '#dd925c');
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.ellipse(0, headY, 9.2, 10.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Modern Tapered Haircut
    ctx.fillStyle = '#1c1917';
    ctx.beginPath();
    ctx.arc(0, headY - 2.6, 9.8, Math.PI * 0.94, Math.PI * 2.06);
    ctx.quadraticCurveTo(5, headY - 6.8, 0, headY - 5.2);
    ctx.quadraticCurveTo(-5, headY - 6.8, -9.2, headY - 2.4);
    ctx.closePath();
    ctx.fill();

    // Focused Eyebrows & Eyes
    ctx.strokeStyle = '#1c1917';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-5.2, headY - 2.8); ctx.lineTo(-1.8, headY - 2);
    ctx.moveTo(5.2, headY - 2.8); ctx.lineTo(1.8, headY - 2);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(-3.2, headY - 0.5, 1.35, 0, Math.PI * 2);
    ctx.arc(3.2, headY - 0.5, 1.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawProSoccerBall(ctx, x, y, br, spinAngle, isSuper) {
    ctx.save();
    ctx.translate(x, y);

    if (isSuper) {
      const aura = ctx.createRadialGradient(0, 0, br * 0.4, 0, 0, br * 2.1);
      aura.addColorStop(0, 'rgba(250, 204, 21, 0.7)');
      aura.addColorStop(0.5, 'rgba(249, 115, 22, 0.35)');
      aura.addColorStop(1, 'rgba(249, 115, 22, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(0, 0, br * 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Spherical 3D shading
    const grad = ctx.createRadialGradient(-br * 0.32, -br * 0.35, br * 0.1, 0, 0, br);
    if (isSuper) {
      grad.addColorStop(0, '#fef9c3');
      grad.addColorStop(0.55, '#facc15');
      grad.addColorStop(1, '#b45309');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.65, '#e2e8f0');
      grad.addColorStop(1, '#64748b');
    }
    ctx.beginPath();
    ctx.arc(0, 0, br, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Clip rotating panels inside sphere
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, br - 0.5, 0, Math.PI * 2);
    ctx.clip();

    const cx = Math.sin(spinAngle) * br * 0.35;
    const cy = Math.cos(spinAngle * 0.7) * br * 0.25;
    ctx.fillStyle = isSuper ? '#7c2d12' : '#0f172a';
    // Center pentagon
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = spinAngle + (i / 5) * Math.PI * 2;
      const px = cx + Math.cos(a) * br * 0.34;
      const py = cy + Math.sin(a) * br * 0.34;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    // Seam lines + outer patches
    ctx.strokeStyle = isSuper ? 'rgba(124,45,18,0.65)' : 'rgba(15,23,42,0.55)';
    ctx.lineWidth = Math.max(1, br * 0.08);
    for (let i = 0; i < 5; i++) {
      const a = spinAngle + (i / 5) * Math.PI * 2;
      const x1 = cx + Math.cos(a) * br * 0.32;
      const y1 = cy + Math.sin(a) * br * 0.32;
      const x2 = cx + Math.cos(a) * br * 0.92;
      const y2 = cy + Math.sin(a) * br * 0.92;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x2, y2, br * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Crisp rim & top specular shine
    ctx.beginPath();
    ctx.arc(0, 0, br, 0, Math.PI * 2);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = isSuper ? '#fef08a' : '#1e293b';
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.ellipse(-br * 0.3, -br * 0.34, br * 0.24, br * 0.14, -0.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  let prevRenderPhase = null;
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

    const state = latestState;
    const shot = state && state.currentShot;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Camera Shake on Goal / Kick
    if (state && state.phase !== prevRenderPhase) {
      if (state.phase === 'kick') {
        spawnTurfBurst(w * 0.5, h * 0.84, 16);
        ballTrail.length = 0;
      }
      if (state.phase === 'result' && shot && shot.outcome === 'goal') {
        screenShake = shot.isSuper ? 12 : 7;
        flashAlpha = 0.35;
      }
      prevRenderPhase = state.phase;
    }

    if (screenShake > 0.1) {
      screenShake *= Math.pow(0.03, dt);
      ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
    }

    // 1. Night Sky & Stadium Floodlights
    const horizon = h * 0.34;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#030816');
    sky.addColorStop(1, '#102652');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);

    [w * 0.14, w * 0.86].forEach((lx) => {
      // Floodlight tower + glowing lamp bank
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(lx - 4, h * 0.03, 8, h * 0.14);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(lx - 20, h * 0.015, 40, 12);
      for (let bx = -14; bx <= 14; bx += 7) {
        ctx.fillStyle = '#fef9c3';
        ctx.beginPath();
        ctx.arc(lx + bx, h * 0.028, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      const beam = ctx.createRadialGradient(lx, h * 0.03, 6, lx, h * 0.03, w * 0.65);
      beam.addColorStop(0, 'rgba(255, 252, 230, 0.5)');
      beam.addColorStop(0.35, 'rgba(186, 230, 253, 0.12)');
      beam.addColorStop(1, 'rgba(255, 252, 230, 0)');
      ctx.fillStyle = beam;
      ctx.fillRect(0, 0, w, h * 0.72);
    });

    // Stands + Animated Stadium Crowd Sparkles
    ctx.fillStyle = '#091229';
    ctx.fillRect(0, horizon - h * 0.12, w, h * 0.12);
    for (let x = 8; x < w; x += 13) {
      for (let y = horizon - h * 0.105; y < horizon - 5; y += 10) {
        const flashCrowd = Math.sin(now * 0.01 + x * y) > 0.88;
        ctx.fillStyle = flashCrowd ? 'rgba(255,255,255,0.7)' : 'rgba(148,163,184,0.22)';
        ctx.fillRect(x + ((y * 3) % 5), y, 3, 3);
      }
    }

    // Glowing LED Perimeter Advertising Board
    const ledGrad = ctx.createLinearGradient(0, 0, w, 0);
    ledGrad.addColorStop(0, '#0284c7');
    ledGrad.addColorStop(0.5, '#f5c542');
    ledGrad.addColorStop(1, '#22c55e');
    ctx.fillStyle = ledGrad;
    ctx.fillRect(0, horizon - 4, w, 4);

    // 2. Green Pitch + Mowed Stripes + Penalty Box
    const pitch = ctx.createLinearGradient(0, horizon, 0, h);
    pitch.addColorStop(0, '#14532d');
    pitch.addColorStop(0.45, '#16803d');
    pitch.addColorStop(1, '#115e2d');
    ctx.fillStyle = pitch;
    ctx.fillRect(0, horizon, w, h - horizon);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    for (let i = 0; i < 8; i += 2) {
      const y1 = horizon + (h - horizon) * (i / 8);
      const y2 = horizon + (h - horizon) * ((i + 1) / 8);
      ctx.fillRect(0, y1, w, y2 - y1);
    }

    const goalW = w * 0.8;
    const goalH = h * 0.29;
    const goalX = (w - goalW) * 0.5;
    const goalY = horizon - goalH * 0.46;
    const goalBottom = goalY + goalH;
    const depthX = w * 0.055;
    const depthY = h * 0.04;
    const backX = goalX + depthX;
    const backW = goalW - depthX * 2;
    const backY = goalY + depthY;
    const backBottom = goalBottom - depthY * 0.35;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.beginPath();
    ctx.moveTo(w * 0.06, goalBottom + h * 0.25);
    ctx.lineTo(goalX - w * 0.03, goalBottom);
    ctx.lineTo(goalX + goalW + w * 0.03, goalBottom);
    ctx.lineTo(w * 0.94, goalBottom + h * 0.25);
    ctx.closePath();
    ctx.stroke();

    // Penalty Spot
    const spotX = w * 0.5;
    const spotY = h * 0.84;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(spotX, spotY, w * 0.02, w * 0.009, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. 3D Perspective Goal & Dynamic Netting
    if (netRipple > 0) netRipple = Math.max(0, netRipple - dt * 1.3);
    const bulge = Math.sin(now * 0.045) * netRipple * 14;

    // 3D Interior Shading
    const netShade = ctx.createLinearGradient(0, goalY, 0, goalBottom);
    netShade.addColorStop(0, 'rgba(2, 6, 23, 0.72)');
    netShade.addColorStop(1, 'rgba(6, 28, 18, 0.52)');
    ctx.fillStyle = netShade;
    ctx.beginPath();
    ctx.moveTo(goalX, goalBottom);
    ctx.lineTo(goalX, goalY);
    ctx.lineTo(goalX + goalW, goalY);
    ctx.lineTo(goalX + goalW, goalBottom);
    ctx.closePath();
    ctx.fill();

    // Back Net Mesh (with impact wave)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.lineWidth = 1;
    for (let x = backX; x <= backX + backW; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, backY);
      ctx.quadraticCurveTo(x + bulge, (backY + backBottom) * 0.5, x, backBottom);
      ctx.stroke();
    }
    for (let y = backY; y <= backBottom; y += 13) {
      ctx.beginPath();
      ctx.moveTo(backX, y);
      ctx.quadraticCurveTo(w * 0.5, y + bulge * 0.8, backX + backW, y);
      ctx.stroke();
    }
    // Roof & Side perspective net connectors
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    for (let i = 0; i <= 6; i++) {
      const fx = goalX + (goalW * i) / 6;
      const bx = backX + (backW * i) / 6;
      ctx.beginPath();
      ctx.moveTo(fx, goalY);
      ctx.lineTo(bx, backY);
      ctx.stroke();
    }
    // Back metal supports
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(goalX, goalY); ctx.lineTo(backX, backY); ctx.lineTo(backX, backBottom); ctx.lineTo(goalX, goalBottom);
    ctx.moveTo(goalX + goalW, goalY); ctx.lineTo(backX + backW, backY); ctx.lineTo(backX + backW, backBottom); ctx.lineTo(goalX + goalW, goalBottom);
    ctx.stroke();

    // 3 Target Spotlights inside Goal (hide during result so replay/action stays crisp)
    const targetXs = { 1: goalX + goalW * 0.16, 2: goalX + goalW * 0.5, 3: goalX + goalW * 0.84 };
    const targetYs = { 1: goalY + goalH * 0.46, 2: goalY + goalH * 0.22, 3: goalY + goalH * 0.46 };

    if (!state || state.phase !== 'result') {
      [1, 2, 3].forEach((z) => {
        const isSelected = shot && shot.zone === z;
        ctx.save();
        ctx.globalAlpha = state && state.phase === 'kick' ? (isSelected ? 0.85 : 0.22) : 1;
        ctx.beginPath();
        ctx.arc(targetXs[z], targetYs[z], w * 0.056, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? 'rgba(245, 197, 66, 0.42)' : 'rgba(15, 23, 42, 0.55)';
        ctx.fill();
        ctx.lineWidth = isSelected ? 3.5 : 1.5;
        ctx.strokeStyle = isSelected ? '#fde047' : 'rgba(255, 255, 255, 0.35)';
        if (isSelected) { ctx.shadowColor = '#facc15'; ctx.shadowBlur = 14; }
        ctx.stroke();
        ctx.fillStyle = isSelected ? '#fef08a' : 'rgba(255, 255, 255, 0.88)';
        ctx.font = `900 ${Math.round(w * 0.05)}px Montserrat, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(z), targetXs[z], targetYs[z] + 1);
        ctx.restore();
      });
    }

    // Metallic 3D Front Posts, Crossbar & Turf Anchors
    const postW = Math.max(6, w * 0.022);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = postW;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(goalX, goalBottom);
    ctx.lineTo(goalX, goalY);
    ctx.lineTo(goalX + goalW, goalY);
    ctx.lineTo(goalX + goalW, goalBottom);
    ctx.stroke();

    // Inner specular highlight along frame
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = postW * 0.46;
    ctx.beginPath();
    ctx.moveTo(goalX - 1, goalBottom);
    ctx.lineTo(goalX - 1, goalY - 1);
    ctx.lineTo(goalX + goalW + 1, goalY - 1);
    ctx.lineTo(goalX + goalW + 1, goalBottom);
    ctx.stroke();

    // Post base sockets on grass
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.ellipse(goalX, goalBottom + 2, postW * 0.7, postW * 0.28, 0, 0, Math.PI * 2);
    ctx.ellipse(goalX + goalW, goalBottom + 2, postW * 0.7, postW * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 4. Kick & Goalkeeper Animation Timings
    if (state && state.phase === 'kick') {
      kickAnimProgress = Math.min(1, kickAnimProgress + dt / 0.78);
    } else if (state && state.phase === 'result') {
      kickAnimProgress = 1;
    } else {
      kickAnimProgress = 0;
    }

    let keeperX = w * 0.5;
    let keeperY = goalBottom - h * 0.092;
    let diveDir = 0;
    let diveT = 0;
    if (state && (state.phase === 'kick' || state.phase === 'result') && shot) {
      diveT = Math.min(1, kickAnimProgress * 1.25);
      const ease = 1 - Math.pow(1 - diveT, 3);
      diveDir = shot.keeperZone === 1 ? -1 : shot.keeperZone === 3 ? 1 : 0;
      const destX = shot.keeperZone === 1 ? goalX + goalW * 0.19 : shot.keeperZone === 3 ? goalX + goalW * 0.81 : w * 0.5;
      keeperX = w * 0.5 + (destX - w * 0.5) * ease;
      keeperY = (goalBottom - h * 0.092) - Math.sin(ease * Math.PI) * (h * 0.055);
      diveT = ease;
    } else {
      keeperX = w * 0.5 + Math.sin(now * 0.0055) * (goalW * 0.055);
    }

    drawProGoalkeeper(ctx, keeperX, keeperY, (w / 410) * 1.15, now, state ? state.phase : 'aim', diveDir, diveT, shot && shot.outcome);

    // 5. Ball Trajectory, Motion Trail & 3D Spinning Ball
    let ballX = spotX;
    let ballY = spotY;
    let ballScale = 1;
    let arcLift = 0;
    const isSuper = !!(shot && shot.isSuper);

    if (state && (state.phase === 'kick' || state.phase === 'result') && shot) {
      const t = kickAnimProgress;
      const ease = 1 - Math.pow(1 - t, 2.1);
      const endX = targetXs[shot.zone] || w * 0.5;
      const endY = shot.outcome === 'saved' ? keeperY - 6 : (targetYs[shot.zone] || targetYs[2]) + 4;
      arcLift = Math.sin(t * Math.PI) * (h * 0.09);
      ballX = spotX + (endX - spotX) * ease;
      ballY = spotY + (endY - spotY) * ease - arcLift;
      ballScale = 1 - ease * 0.44;
      if (state.phase === 'kick') {
        ballSpin += dt * (isSuper ? 24 : 16);
        ballTrail.push({ x: ballX, y: ballY, r: Math.max(8, w * 0.044) * ballScale, life: 1 });
        if (ballTrail.length > 10) ballTrail.shift();
        if (isSuper) {
          sparks.push({ x: ballX, y: ballY, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, life: 1 });
        }
      }
    } else {
      ballTrail.length = 0;
    }

    // Turf & Spark Particles
    for (let i = turfParticles.length - 1; i >= 0; i--) {
      const tp = turfParticles[i];
      tp.x += tp.vx * dt;
      tp.y += tp.vy * dt;
      tp.vy += 260 * dt;
      tp.life -= dt * 1.8;
      if (tp.life <= 0) { turfParticles.splice(i, 1); continue; }
      ctx.globalAlpha = tp.life;
      ctx.fillStyle = tp.col;
      ctx.fillRect(tp.x, tp.y, 4, 4);
      ctx.globalAlpha = 1;
    }

    // Ball Shadow on Turf
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0.14, 0.42 - arcLift * 0.004)})`;
    ctx.beginPath();
    ctx.ellipse(ballX, ballY + arcLift * 0.5 + 14 * ballScale, 16 * ballScale, 6 * ballScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Speed Trail
    for (let i = 0; i < ballTrail.length; i++) {
      const tr = ballTrail[i];
      tr.life -= dt * 3.5;
      if (tr.life <= 0) continue;
      ctx.globalAlpha = tr.life * 0.25;
      ctx.fillStyle = isSuper ? '#facc15' : '#e2e8f0';
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, tr.r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

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
      ctx.arc(sp.x, sp.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    const br = Math.max(10, w * 0.046) * ballScale;
    drawProSoccerBall(ctx, ballX, ballY, br, ballSpin, isSuper);

    // Goal Stadium Flash + Confetti
    if (flashAlpha > 0.01) {
      flashAlpha *= Math.pow(0.05, dt);
      ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }
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
