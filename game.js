(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const elStage = document.getElementById("stage");
  const elScore = document.getElementById("score");
  const elGoal  = document.getElementById("goal");
  const elLives = document.getElementById("lives");

  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText  = document.getElementById("overlayText");
  const btnPrimary   = document.getElementById("btnPrimary");
  const btnSecondary = document.getElementById("btnSecondary");

  const btnPause = document.getElementById("btnPause");
  const btnSound = document.getElementById("btnSound");

  const leftBtn  = document.getElementById("leftBtn");
  const rightBtn = document.getElementById("rightBtn");

  // Audio (simple)
  let soundOn = true;
  let audioCtx = null;
  function beep(freq = 440, duration = 0.06, type = "sine", gain = 0.06){
    if(!soundOn) return;
    try{
      if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + duration);
    }catch(_){}
  }

  // ----- Constants -----
  const MAX_STAGE = 100;

  // Game state
  let stage = 1;
  let score = 0;
  let goal = 0;
  let lives = 1;

  let running = false;
  let paused = false;
  let gameOver = false;

  const player = {
    x: canvas.width / 2,
    y: canvas.height * 0.84,
    w: 44,
    h: 44,
    vx: 0,
    speed: 560, // px/s
    c1: "#34ff8b",
    c2: "#00d46a"
  };

  // Entities
  let enemies = [];
  let warnings = [];  // {x,w,t,life}  -> draw before heavy spawn
  let particles = [];
  let shake = 0;

  const keys = { left:false, right:false };
  let touchLeft = false;
  let touchRight = false;

  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function rand(a,b){ return a + Math.random()*(b-a); }

  // Difficulty curve
  function stageConfig(n){
    const t = (n - 1) / (MAX_STAGE - 1); // 0..1

    // count rises 1..7
    const count = 1 + Math.floor(6 * Math.pow(t, 1.02));

    // speeds
    const baseFall = 220 + 620 * Math.pow(t, 0.95);
    const goalPoints = 7 + Math.floor(7 * t) + Math.floor(n / 3);

    // enemy size trend
    const size = 34 - Math.floor(6 * t);

    // probabilities (unlock gradually)
    const pZig   = n < 6  ? 0 : clamp(0.10 + 0.28*t, 0.10, 0.40);
    const pBurst = n < 10 ? 0 : clamp(0.10 + 0.24*t, 0.10, 0.35);
    const pHeavy = n < 15 ? 0 : clamp(0.06 + 0.18*t, 0.06, 0.26);

    // heavy spawn warning duration
    const warnLife = 0.55 + 0.25*(1-t); // slightly longer early

    return { t, count, baseFall, goalPoints, size, pZig, pBurst, pHeavy, warnLife };
  }

  function setHud(){
    elStage.textContent = String(stage);
    elScore.textContent = String(score);
    elGoal.textContent  = String(goal);
    elLives.textContent = String(lives);
  }

  function showOverlay(title, text, primaryLabel, secondaryLabel){
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    btnPrimary.textContent = primaryLabel;
    btnSecondary.textContent = secondaryLabel;
    overlay.classList.remove("hidden");
  }
  function hideOverlay(){ overlay.classList.add("hidden"); }

  // Visual helpers
  function drawGlowRect(x,y,w,h,c1,c2){
    ctx.save();
    ctx.shadowColor = c1;
    ctx.shadowBlur = 14;
    const g = ctx.createLinearGradient(x,y, x+w, y+h);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(x,y,w,h);
    ctx.restore();
  }

  function spawnBurstParticles(x, y, n=40, color="#fff"){
    for(let i=0;i<n;i++){
      const a = Math.random()*Math.PI*2;
      const sp = 140 + Math.random()*560;
      particles.push({
        x, y,
        vx: Math.cos(a)*sp,
        vy: Math.sin(a)*sp,
        r: 1.5 + Math.random()*3.2,
        life: 0.45 + Math.random()*0.55,
        t: 0,
        color
      });
    }
  }

  function updateParticles(dt){
    for(const p of particles){
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= (1 - 1.8*dt);
      p.vy *= (1 - 1.8*dt);
      p.vy += 430 * dt;
    }
    particles = particles.filter(p => p.t < p.life);
  }
  function drawParticles(){
    for(const p of particles){
      const alpha = 1 - (p.t / p.life);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Enemy factory
  function pickType(cfg){
    // Weighted choice: heavy, zig, burst, normal
    const r = Math.random();
    if(r < cfg.pHeavy) return "heavy";
    if(r < cfg.pHeavy + cfg.pZig) return "zig";
    if(r < cfg.pHeavy + cfg.pZig + cfg.pBurst) return "burst";
    return "normal";
  }

  function enemyColors(type){
    if(type === "normal") return ["hsl(0,95%,58%)","hsl(0,95%,44%)"];        // red
    if(type === "burst")  return ["hsl(28,95%,58%)","hsl(28,95%,44%)"];      // orange
    if(type === "zig")    return ["hsl(280,90%,62%)","hsl(280,90%,48%)"];    // purple
    if(type === "heavy")  return ["hsl(55,95%,60%)","hsl(55,95%,45%)"];      // warning yellow
    return ["#fff","#ddd"];
  }

  function makeEnemy(cfg, type){
    const baseSize = cfg.size;
    let w = baseSize, h = baseSize;
    let vy = cfg.baseFall * rand(0.85, 1.25);
    let vx = 0;

    const x = rand(0, canvas.width - w);
    const y = -rand(40, canvas.height * 0.75) - h;

    if(type === "zig"){
      vx = (160 + 260*Math.random()) * (Math.random() < 0.5 ? -1 : 1);
      vy *= 0.95;
    }

    if(type === "burst"){
      vy *= 1.00;
    }

    if(type === "heavy"){
      w = baseSize + 14;
      h = baseSize + 14;
      vy = cfg.baseFall * rand(1.25, 1.55);
    }

    const [c1,c2] = enemyColors(type);

    return {
      type,
      x, y, w, h,
      vy, vx,
      burstTimer: 0,
      burstCooldown: rand(0.85, 1.35),
      zig: type === "zig",
      c1, c2
    };
  }

  // Heavy warning then spawn
  function queueHeavy(cfg){
    const size = cfg.size + 14;
    const x = rand(0, canvas.width - size);
    warnings.push({ x, w: size, t: 0, life: cfg.warnLife });
    beep(920, 0.03, "square", 0.03);
  }

  function resetStage(n){
    stage = n;
    score = 0;
    lives = 1;

    const cfg = stageConfig(stage);
    goal = cfg.goalPoints;

    player.x = (canvas.width - player.w) / 2;
    player.vx = 0;

    enemies = [];
    warnings = [];
    particles = [];
    shake = 0;

    // Spawn initial set
    for(let i=0;i<cfg.count;i++){
      const type = pickType(cfg);
      if(type === "heavy"){
        queueHeavy(cfg);
      }else{
        enemies.push(makeEnemy(cfg, type));
      }
    }

    gameOver = false;
    paused = false;
    setHud();
  }

  function startGame(){
    resetStage(1);
    running = true;
    hideOverlay();
    beep(520, 0.05, "triangle", 0.05);
  }
  function startStage(){
    running = true;
    hideOverlay();
    beep(640, 0.05, "triangle", 0.05);
  }

  function completeStage(){
    running = false;
    beep(880, 0.08, "sine", 0.07);
    spawnBurstParticles(canvas.width/2, canvas.height*0.35, 80, "#7c5cff");
    spawnBurstParticles(canvas.width/2, canvas.height*0.35, 55, "#34ff8b");

    if(stage >= MAX_STAGE){
      showOverlay("🏆 You Did It!", "Stage 100 cleared. You beat the full run!", "Play Again", "OK");
      btnSecondary.style.display = "none";
      btnPrimary.onclick = () => { btnSecondary.style.display = ""; startGame(); };
      return;
    }

    showOverlay("✅ Stage Clear", `Nice! Ready for Stage ${stage+1}?`, "Next Stage", "Replay");
    btnPrimary.onclick = () => { resetStage(stage + 1); startStage(); };
    btnSecondary.onclick = () => { resetStage(stage); startStage(); };
  }

  function doGameOver(){
    running = false;
    gameOver = true;
    beep(170, 0.12, "sawtooth", 0.045);
    shake = 12;
    spawnBurstParticles(player.x + player.w/2, player.y + player.h/2, 70, "#ff3b3b");
    showOverlay("💥 Game Over", `You reached ${score}/${goal} for Stage ${stage}. Try again.`, "Retry", "Main Menu");
    btnPrimary.onclick = () => { resetStage(stage); startStage(); };
    btnSecondary.onclick = () => {
      resetStage(1);
      showOverlay("Dodge the Box", "Survive 100 stages. Different enemy types appear as you progress.", "Start", "How to Play");
    };
  }

  function hit(){
    lives--;
    elLives.textContent = String(lives);
    shake = 10;
    beep(260, 0.06, "square", 0.03);
    spawnBurstParticles(player.x + player.w/2, player.y + player.h/2, 26, "#ffcc66");

    if(lives <= 0){
      doGameOver();
      return;
    }

    // brief invulnerable feel: knock enemies up a bit
    for(const e of enemies){
      e.y -= 90;
    }
  }

  // Loop
  let last = performance.now();
  function frame(now){
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    if(running && !paused){
      update(dt);
    }
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function update(dt){
    const cfg = stageConfig(stage);

    // Player move
    const left = keys.left || touchLeft;
    const right = keys.right || touchRight;
    let dir = 0;
    if(left && !right) dir = -1;
    if(right && !left) dir = 1;

    player.vx = dir * player.speed;
    player.x += player.vx * dt;
    player.x = clamp(player.x, 0, canvas.width - player.w);

    // Warnings countdown -> spawn heavy
    for(const w of warnings){
      w.t += dt;
      if(w.t >= w.life){
        // spawn heavy exactly at warned x
        const e = makeEnemy(cfg, "heavy");
        e.x = w.x;
        e.y = -e.h;
        enemies.push(e);
        beep(740, 0.03, "triangle", 0.03);
        spawnBurstParticles(w.x + w.w/2, 46, 10, "#ffcc66");
      }
    }
    warnings = warnings.filter(w => w.t < w.life);

    // Enemies update
    for(const e of enemies){
      e.y += e.vy * dt;

      if(e.type === "zig"){
        e.x += e.vx * dt;
        if(e.x < 0){ e.x = 0; e.vx *= -1; }
        if(e.x + e.w > canvas.width){ e.x = canvas.width - e.w; e.vx *= -1; }
      }

      if(e.type === "burst"){
        e.burstTimer += dt;
        if(e.burstTimer >= e.burstCooldown){
          e.burstTimer = 0;
          e.burstCooldown = rand(0.75, 1.35);
          e.y += 75 + rand(0,35); // sudden jump
          spawnBurstParticles(e.x + e.w/2, e.y + e.h/2, 12, "#ffcc66");
          beep(820, 0.03, "square", 0.02);
        }
      }

      // Passed bottom -> score + respawn another enemy (possibly new type)
      if(e.y > canvas.height + 60){
        score++;
        elScore.textContent = String(score);
        beep(420, 0.02, "sine", 0.02);

        // respawn
        const type = pickType(cfg);
        if(type === "heavy"){
          // replace with warning instead
          e.y = canvas.height + 1000; // send away; filtered below
          queueHeavy(cfg);
        }else{
          const ne = makeEnemy(cfg, type);
          e.type = ne.type;
          e.x = ne.x; e.y = ne.y; e.w = ne.w; e.h = ne.h;
          e.vy = ne.vy; e.vx = ne.vx;
          e.burstTimer = 0; e.burstCooldown = ne.burstCooldown;
          e.c1 = ne.c1; e.c2 = ne.c2;
        }

        if(score >= goal){
          completeStage();
          return;
        }
      }

      // Collision
      if(
        player.x < e.x + e.w &&
        player.x + player.w > e.x &&
        player.y < e.y + e.h &&
        player.y + player.h > e.y
      ){
        hit();
        return;
      }
    }

    enemies = enemies.filter(e => e.y < canvas.height + 500);

    updateParticles(dt);
  }

  function draw(){
    // screen shake
    let sx = 0, sy = 0;
    if(shake > 0){
      sx = (Math.random()*2-1) * shake;
      sy = (Math.random()*2-1) * shake;
      shake = Math.max(0, shake - 40 * (1/60));
    }

    ctx.save();
    ctx.translate(sx, sy);

    ctx.clearRect(-20, -20, canvas.width+40, canvas.height+40);

    // faint grid
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    const step = 48;
    for(let x=0; x<canvas.width; x+=step){
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
    }
    for(let y=0; y<canvas.height; y+=step){
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Warnings
    for(const w of warnings){
      const alpha = clamp(0.15 + 0.55 * (w.t / w.life), 0.15, 0.7);
      ctx.globalAlpha = alpha;
      const g = ctx.createLinearGradient(w.x, 0, w.x + w.w, 0);
      g.addColorStop(0, "rgba(255,204,102,0)");
      g.addColorStop(0.5, "rgba(255,204,102,0.55)");
      g.addColorStop(1, "rgba(255,204,102,0)");
      ctx.fillStyle = g;
      ctx.fillRect(w.x, 0, w.w, canvas.height);

      // top warning badge
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(255,204,102,0.85)";
      ctx.fillRect(w.x, 0, w.w, 10);

      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,204,102,0.95)";
      ctx.font = "900 14px ui-sans-serif, system-ui";
      ctx.fillText("⚠", w.x + w.w/2 - 6, 28);
    }
    ctx.globalAlpha = 1;

    // Player
    drawGlowRect(player.x, player.y, player.w, player.h, player.c1, player.c2);

    // Enemies
    for(const e of enemies){
      drawGlowRect(e.x, e.y, e.w, e.h, e.c1, e.c2);
    }

    drawParticles();

    // progress bar
    const pad = 14;
    const barW = canvas.width - pad*2;
    const barH = 10;
    const px = pad;
    const py = pad;

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(231,236,255,.12)";
    ctx.fillRect(px, py, barW, barH);

    const pct = clamp(score / Math.max(1, goal), 0, 1);
    const grad = ctx.createLinearGradient(px, py, px+barW, py);
    grad.addColorStop(0, "#7c5cff");
    grad.addColorStop(1, "#34ff8b");
    ctx.fillStyle = grad;
    ctx.fillRect(px, py, barW * pct, barH);
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(231,236,255,.85)";
    ctx.font = "700 14px ui-sans-serif, system-ui";
    ctx.fillText(`Stage ${stage}   ${Math.floor(pct*100)}%`, px, py + 28);

    ctx.restore();
  }

  // UI
  btnSecondary.onclick = () => {
    const isHow = btnSecondary.textContent.includes("How");
    if(isHow){
      overlayText.textContent =
        "Goal: dodge until you reach the stage goal. Enemy types: 🔴 normal, 🟠 burst jumps, 🟣 zigzags, ⚠️ warning then heavy drop. Keyboard (← → / A D) or hold mobile buttons.";
      btnSecondary.textContent = "Back";
    }else{
      overlayText.textContent = "Survive 100 stages. Different enemy types appear as you progress.";
      btnSecondary.textContent = "How to Play";
    }
  };

  btnPrimary.onclick = () => startGame();

  btnPause.onclick = () => {
    if(!overlay.classList.contains("hidden")) return;
    paused = !paused;
    btnPause.textContent = paused ? "▶️" : "⏸";
    beep(paused ? 330 : 520, 0.05, "triangle", 0.04);
  };

  btnSound.onclick = () => {
    soundOn = !soundOn;
    btnSound.textContent = soundOn ? "🔊" : "🔇";
    if(soundOn) beep(660, 0.04, "sine", 0.05);
  };

  // Keyboard
  window.addEventListener("keydown", (e) => {
    if(e.key === "ArrowLeft" || e.key.toLowerCase() === "a") keys.left = true;
    if(e.key === "ArrowRight" || e.key.toLowerCase() === "d") keys.right = true;

    if(e.key === " "){
      e.preventDefault();
      if(overlay.classList.contains("hidden")){
        paused = !paused;
        btnPause.textContent = paused ? "▶️" : "⏸";
        beep(paused ? 330 : 520, 0.05, "triangle", 0.04);
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    if(e.key === "ArrowLeft" || e.key.toLowerCase() === "a") keys.left = false;
    if(e.key === "ArrowRight" || e.key.toLowerCase() === "d") keys.right = false;
  });

  // Touch hold helpers
  function bindHold(btn, setFn){
    const down = (ev) => { ev.preventDefault(); setFn(true); };
    const up   = (ev) => { ev.preventDefault(); setFn(false); };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("pointerleave", up);
  }
  bindHold(leftBtn,  (v) => touchLeft = v);
  bindHold(rightBtn, (v) => touchRight = v);

  // Boot
  resetStage(1);
  showOverlay("Dodge the Box", "Survive 100 stages. Different enemy types appear as you progress.", "Start", "How to Play");
  setHud();
})();
