(() => {
  "use strict";

  // =========================
  //  NEON ROGUE (Canvas)
  // =========================

  // ----- DOM -----
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const ui = {
    hp: document.getElementById("hp"),
    hpMax: document.getElementById("hpMax"),
    shield: document.getElementById("shield"),
    gold: document.getElementById("gold"),
    lvl: document.getElementById("lvl"),
    score: document.getElementById("score"),
    combo: document.getElementById("combo"),
    best: document.getElementById("best"),
    msg: document.getElementById("msg"),
    btnPause: document.getElementById("btnPause"),
    btnRestart: document.getElementById("btnRestart"),
    overlay: document.getElementById("overlay"),
    ovTitle: document.getElementById("ovTitle"),
    ovText: document.getElementById("ovText"),
    ovTiny: document.getElementById("ovTiny"),
    ovPrimary: document.getElementById("ovPrimary"),
    ovRestart: document.getElementById("ovRestart"),
    shopBtns: [...document.querySelectorAll(".buy")],
  };

  // ----- Helpers -----
  const W = canvas.width, H = canvas.height;
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp = (a,b,t)=>a+(b-a)*t;
  const rand = (a,b)=>a+Math.random()*(b-a);
  const randi = (a,b)=>Math.floor(rand(a,b+1));
  const hypot = (x,y)=>Math.hypot(x,y);
  const now = ()=>performance.now();

  const vec = (x=0,y=0)=>({x,y});
  const add = (a,b)=>({x:a.x+b.x,y:a.y+b.y});
  const sub = (a,b)=>({x:a.x-b.x,y:a.y-b.y});
  const mul = (a,k)=>({x:a.x*k,y:a.y*k});
  const len = (v)=>hypot(v.x,v.y);
  const norm = (v)=>{
    const l = len(v);
    return l>0 ? {x:v.x/l,y:v.y/l} : {x:0,y:0};
  };

  function fmt(n){ return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  // roundRect polyfill
  if(!CanvasRenderingContext2D.prototype.roundRect){
    CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
      r = Math.min(r, w/2, h/2);
      this.moveTo(x+r, y);
      this.arcTo(x+w, y, x+w, y+h, r);
      this.arcTo(x+w, y+h, x, y+h, r);
      this.arcTo(x, y+h, x, y, r);
      this.arcTo(x, y, x+w, y, r);
      this.closePath();
      return this;
    };
  }

  // ----- Input -----
  const keys = new Map();
  const mouse = { x: W/2, y: H/2, down: false };

  addEventListener("keydown", (e)=>{
    const k = e.key.toLowerCase();
    keys.set(k,true);
    if(k === "p") togglePause();
    if(k === " ") mouse.down = true;
  });
  addEventListener("keyup", (e)=>{
    const k = e.key.toLowerCase();
    keys.set(k,false);
    if(k === " ") mouse.down = false;
  });

  canvas.addEventListener("mousemove", (e)=>{
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    mouse.x = (e.clientX - r.left) * sx;
    mouse.y = (e.clientY - r.top) * sy;
  });
  canvas.addEventListener("mousedown", ()=> mouse.down = true);
  canvas.addEventListener("contextmenu", e => e.preventDefault());

  addEventListener("contextmenu", (e)=>{
    if(e.target === canvas){
      e.preventDefault();
      shootCharged();
    }
  });
  addEventListener("mouseup", ()=> mouse.down = false);

  function isDown(...ks){
    for(const k of ks){ if(keys.get(k)) return true; }
    return false;
  }

  // ----- Save -----
  const BEST_KEY = "neonrogue_best";
  let best = Number(localStorage.getItem(BEST_KEY) || 0);

  // ----- Game State -----
  const state = {
    paused: false,
    between: false,
    dead: false,

    level: 1,
    score: 0,
    gold: 0,

    combo: 1,
    comboTimer: 0,
    comboWindow: 1700,

    shake: 0,

    // difficulty
    goal: 22,
    progress: 0,
    spawnRate: 1.0,

    // upgrades
    up: {
      maxHp: 100,
      hp: 100,
      shield: 0,
      speed: 1.0,
      dmg: 1,
      rof: 1.0,      // rate of fire multiplier
      radius: 1.0,   // bullet size
      dash: 1.0,     // dash power
    }
  };

  // ----- Entities -----
  const player = {
    p: vec(W*0.5, H*0.65),
    v: vec(0,0),
    r: 14,
    inv: 0,
    facing: 0,

    heat: 0,
    chargedCd: 0,
    dashCd: 0,
    dashTime: 0,
  };

  const bullets = [];
  const enemies = [];
  const drops = [];
  const particles = [];
  const rings = [];

  // ----- Config -----
  const CFG = {
    friction: 0.86,
    accel: 0.92,
    maxSpeed: 6.6,

    bulletSpeed: 11.2,
    bulletLife: 900,
    chargedCdMs: 1650,

    heatRecover: 0.00085, // per ms
    heatCost: 0.22,

    dashCdMs: 1000,
    dashMs: 120,

    enemyMax: 4.8,
    dropChance: 0.24,

    // arena
    pad: 22
  };

  // ----- UI -----
  function msg(text){ ui.msg.textContent = text; }
  function syncUI(){
    ui.hp.textContent = String(Math.max(0, Math.ceil(state.up.hp)));
    ui.hpMax.textContent = String(state.up.maxHp);
    ui.shield.textContent = String(Math.ceil(state.up.shield));
    ui.gold.textContent = fmt(state.gold);
    ui.lvl.textContent = String(state.level);
    ui.score.textContent = fmt(state.score);
    ui.combo.textContent = "x" + state.combo;
    ui.best.textContent = fmt(best);
  }

  function openOverlay(title, text, tiny=""){
    ui.ovTitle.textContent = title;
    ui.ovText.textContent = text;
    ui.ovTiny.textContent = tiny;
    ui.overlay.classList.remove("hidden");
    ui.overlay.setAttribute("aria-hidden","false");
  }
  function closeOverlay(){
    ui.overlay.classList.add("hidden");
    ui.overlay.setAttribute("aria-hidden","true");
  }

  function togglePause(){
    if(state.dead) return;
    state.paused = !state.paused;
    if(state.paused){
      openOverlay("PAUSA", "Presiona P o Continuar para seguir.");
    } else {
      closeOverlay();
      lastT = now();
    }
  }

  ui.btnPause.addEventListener("click", togglePause);
  ui.btnRestart.addEventListener("click", restart);
  ui.ovPrimary.addEventListener("click", ()=>{
    if(state.dead){ restart(); return; }
    if(state.paused && state.between){
      continueAfterShop();
      return;
    }
    if(state.paused) togglePause();
  });
  ui.ovRestart.addEventListener("click", restart);

  // ----- Shop -----
  const SHOP = {
    hp:     { cost: 120, buy(){ state.up.maxHp = Math.min(220, state.up.maxHp + 20); state.up.hp = Math.min(state.up.maxHp, state.up.hp + 20); msg("Compraste HP ✅"); } },
    shield: { cost: 140, buy(){ state.up.shield = Math.min(180, state.up.shield + 20); msg("Compraste escudo ✅"); } },
    spd:    { cost: 160, buy(){ state.up.speed = clamp(state.up.speed + 0.12, 1, 2.2); msg("Velocidad + ✅"); } },
    dmg:    { cost: 180, buy(){ state.up.dmg = Math.min(7, state.up.dmg + 1); msg("Daño + ✅"); } },
    rof:    { cost: 180, buy(){ state.up.rof = clamp(state.up.rof + 0.12, 1, 2.2); msg("Cadencia + ✅"); } },
    rad:    { cost: 150, buy(){ state.up.radius = clamp(state.up.radius + 0.10, 1, 1.8); msg("Proyectil + ✅"); } },
    dash:   { cost: 220, buy(){ state.up.dash = clamp(state.up.dash + 0.18, 1, 2.0); msg("Dash mejorado ✅"); } },
  };

  ui.shopBtns.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      if(!state.between){ msg("La tienda solo funciona entre niveles 🙂"); return; }
      const id = btn.dataset.buy;
      const it = SHOP[id];
      if(!it) return;
      if(state.gold < it.cost){ msg("Te falta oro 😅"); return; }
      state.gold -= it.cost;
      it.buy();
      syncUI();
    });
  });

  // ----- Effects -----
  function ring(x,y,r,a){
    rings.push({ p: vec(x,y), r, a, born: now(), life: 320 });
  }
  function puff(x,y,n,sp,kind="smoke"){
    for(let i=0;i<n;i++){
      particles.push({
        p: vec(x,y),
        v: vec(rand(-sp,sp), rand(-sp,sp)),
        r: rand(1.2, 4.2),
        born: now(),
        life: rand(220, 520),
        a: rand(0.35, 0.95),
        kind
      });
    }
  }
  function sparkle(x,y,n){
    puff(x,y,n,6,"spark");
  }

  // ----- Combat -----
  function bumpCombo(){
    state.combo = clamp(state.combo + 1, 1, 15);
    state.comboTimer = state.comboWindow;
  }
  function resetCombo(){
    state.combo = 1;
    state.comboTimer = 0;
  }

  function addScore(base){
    const add = Math.floor(base * state.combo * (1 + state.level*0.04));
    state.score += add;
    if(state.score > best){
      best = state.score;
      localStorage.setItem(BEST_KEY, String(best));
    }
  }

  function shoot(){
    if(state.between) return;

    // limitador de disparo por "heat"
    if(player.heat > 0.92) return;

    const aim = norm(sub(vec(mouse.x, mouse.y), player.p));
    const spd = CFG.bulletSpeed * lerp(1, 1.25, clamp(state.up.rof-1,0,1.2)/1.2);

    const b = {
      p: add(player.p, mul(aim, player.r+7)),
      v: mul(aim, spd),
      r: 5.2 * state.up.radius,
      born: now(),
      life: CFG.bulletLife,
      dmg: state.up.dmg,
    };
    bullets.push(b);

    player.heat = clamp(player.heat + CFG.heatCost / state.up.rof, 0, 1.3);
    ring(player.p.x, player.p.y, 14, 0.5);
  }

  function shootCharged(){
    if(state.between || player.chargedCd > 0 || player.heat > 1.05) return;

    const aim = norm(sub(vec(mouse.x, mouse.y), player.p));
    const b = {
      p: add(player.p, mul(aim, player.r + 10)),
      v: mul(aim, CFG.bulletSpeed * 0.9),
      r: 10 * state.up.radius,
      born: now(),
      life: CFG.bulletLife + 420,
      dmg: state.up.dmg * 3,
      charged: true,
      pierce: 4
    };
    bullets.push(b);
    player.chargedCd = CFG.chargedCdMs / lerp(1, 1.35, clamp(state.up.rof-1,0,1.2)/1.2);
    player.heat = clamp(player.heat + 0.62, 0, 1.3);
    msg("Disparo cargado ⚡");
    ring(player.p.x, player.p.y, 24, 0.65);
    sparkle(player.p.x, player.p.y, 10);
  }

  function circleHit(ap,ar,bp,br){
    return len(sub(ap,bp)) < (ar+br);
  }

  function killEnemy(e){
    e.alive = false;

    // progreso y oro
    const prog = e.kind === "tank" ? 3 : e.kind === "sniper" ? 2 : 1;
    state.progress += prog;

    const gold = e.kind === "tank" ? randi(12,18) : e.kind === "sniper" ? randi(10,14) : randi(7,12);
    state.gold += gold;

    addScore(70 + prog*30);
    bumpCombo();

    sparkle(e.p.x, e.p.y, 16);
    puff(e.p.x, e.p.y, 14, 12);
    state.shake = Math.max(state.shake, 5);

    // drop
    if(Math.random() < CFG.dropChance){
      spawnDrop(e.p.x, e.p.y);
    }
  }

  function spawnDrop(x,y){
    const t = Math.random();
    const type = t < 0.45 ? "heal" : t < 0.75 ? "shield" : t < 0.90 ? "bomb" : "gold";
    drops.push({ type, p: vec(x,y), r: 12, t: 0 });
  }

  function applyDrop(d){
    if(d.type === "heal"){
      state.up.hp = Math.min(state.up.maxHp, state.up.hp + 25);
      msg("Recogiste curación ✅");
    }
    else if(d.type === "shield"){
      state.up.shield = Math.min(180, state.up.shield + 25);
      msg("Recogiste escudo ✅");
    }
    else if(d.type === "bomb"){
      msg("¡Explosión! 💥");
      areaBlast(player.p.x, player.p.y, 160, 3 + Math.floor(state.up.dmg*0.4));
    }
    else if(d.type === "gold"){
      const g = randi(25,45);
      state.gold += g;
      msg(`+${g} oro ✅`);
    }
    sparkle(d.p.x, d.p.y, 18);
    ring(d.p.x, d.p.y, 22, 0.55);
  }

  function areaBlast(x,y,rad,dmg){
    ring(x,y,rad*0.55,0.65);
    puff(x,y,40,22);
    state.shake = Math.max(state.shake, 12);

    for(const e of enemies){
      if(!e.alive) continue;
      if(len(sub(e.p, vec(x,y))) <= rad){
        e.hp -= dmg;
        sparkle(e.p.x, e.p.y, 8);
        if(e.hp <= 0) killEnemy(e);
      }
    }
  }

  // ----- Enemies / AI -----
  function spawnEnemy(initial=false){
    const side = randi(0,3);
    let p = vec(0,0);
    if(side===0) p = vec(rand(20,W-20), -24);
    if(side===1) p = vec(W+24, rand(20,H-20));
    if(side===2) p = vec(rand(20,W-20), H+24);
    if(side===3) p = vec(-24, rand(20,H-20));

    // tipos
    const t = Math.random();
    const kind = t < 0.62 ? "chaser" : t < 0.83 ? "zig" : t < 0.94 ? "sniper" : "tank";

    const base = 1.25 + state.level*0.10;
    let spd = clamp(rand(base*0.75, base*1.25), 1.0, CFG.enemyMax);

    let r = 13, hp = 2;
    if(kind === "zig"){ r = 14; hp = 2 + Math.floor(state.level*0.18); }
    if(kind === "sniper"){ r = 13; hp = 2 + Math.floor(state.level*0.20); spd *= 0.95; }
    if(kind === "tank"){ r = 18; hp = 6 + Math.floor(state.level*0.35); spd *= 0.82; }

    const e = {
      kind,
      p,
      v: vec(0,0),
      r,
      hp,
      spd,
      alive: true,
      t: rand(0, 1000),
      zigDir: Math.random()<0.5 ? -1 : 1,

      // sniper
      shootCd: rand(700, 1100),
    };
    enemies.push(e);

    if(!initial) puff(p.x,p.y,10,12);
  }

  function maybeSpawn(dt){
    const want = clamp(6 + Math.floor(state.level*0.9), 6, 22);
    const cap = want;

    const chance = (0.010 * state.spawnRate) * (dt/16.67);
    if(enemies.length < cap && Math.random() < chance) spawnEnemy(false);
  }

  function hurtPlayer(dmg){
    // invulnerable
    if(player.inv > 0) return;

    // shield first
    if(state.up.shield > 0){
      const used = Math.min(state.up.shield, dmg*12);
      state.up.shield -= used;
      dmg = Math.max(0, dmg - used/12);
      puff(player.p.x, player.p.y, 10, 10);
    }

    if(dmg > 0){
      state.up.hp -= dmg*14;
      puff(player.p.x, player.p.y, 24, 14);
      state.shake = Math.max(state.shake, 14);
      resetCombo();
      msg("¡Te golpearon! Usa dash para escapar 😵");
    }

    player.inv = 1000;

    if(state.up.hp <= 0){
      gameOver();
    }
  }

  const enemyBullets = [];
  function sniperShoot(e){
    const dir = norm(sub(player.p, e.p));
    enemyBullets.push({
      p: add(e.p, mul(dir, e.r+6)),
      v: mul(dir, 8.5 + state.level*0.15),
      r: 4.5,
      born: now(),
      life: 1100,
    });
    ring(e.p.x, e.p.y, 14, 0.45);
  }

  function updateEnemies(dt){
    // enemy bullets
    const tnow = now();
    for(let i=enemyBullets.length-1;i>=0;i--){
      const b = enemyBullets[i];
      b.p.x += b.v.x;
      b.p.y += b.v.y;
      if(tnow - b.born > b.life){ enemyBullets.splice(i,1); continue; }
      if(b.p.x<-40||b.p.x>W+40||b.p.y<-40||b.p.y>H+40){ enemyBullets.splice(i,1); continue; }

      if(circleHit(b.p, b.r, player.p, player.r)){
        enemyBullets.splice(i,1);
        hurtPlayer(2);
      }
    }

    // enemies
    for(const e of enemies){
      if(!e.alive) continue;
      e.t += dt;

      const toP = sub(player.p, e.p);
      const n = norm(toP);

      if(e.kind === "chaser"){
        e.v = mul(n, e.spd);
      }
      else if(e.kind === "zig"){
        const perp = vec(-n.y, n.x);
        const s = Math.sin(e.t*0.006) * e.zigDir;
        e.v = add(mul(n, e.spd*0.85), mul(perp, e.spd*0.72*s));
      }
      else if(e.kind === "tank"){
        e.v = mul(n, e.spd*0.78);
      }
      else if(e.kind === "sniper"){
        // mantiene distancia
        const d = len(toP);
        if(d < 210) e.v = mul(n, -e.spd*0.90);
        else if(d > 320) e.v = mul(n, e.spd*0.80);
        else e.v = mul(n, 0.15);

        e.shootCd -= dt;
        if(e.shootCd <= 0){
          e.shootCd = rand(820, 1250) * (1.05 - clamp(state.level*0.01,0,0.25));
          sniperShoot(e);
        }
      }

      // move
      e.p.x += e.v.x;
      e.p.y += e.v.y;

      // keep in loose bounds
      e.p.x = clamp(e.p.x, -30, W+30);
      e.p.y = clamp(e.p.y, -30, H+30);

      // collide player
      if(circleHit(e.p, e.r, player.p, player.r+2)){
        if(player.dashTime > 0){
          e.hp -= 3 + Math.floor(state.up.dash*1.5);
          state.shake = Math.max(state.shake, 8);
          sparkle(e.p.x, e.p.y, 12);
          ring(e.p.x, e.p.y, e.r + 6, 0.5);
          if(e.hp <= 0) killEnemy(e);
          continue;
        }
        hurtPlayer(e.kind === "tank" ? 3 : 2);

        // push away
        const push = mul(norm(sub(player.p, e.p)), e.kind==="tank" ? 3.6 : 2.8);
        player.v = add(player.v, push);
      }
    }

    // bullets vs enemies
    for(let bi=bullets.length-1; bi>=0; bi--){
      const b = bullets[bi];
      let used = false;

      for(const e of enemies){
        if(!e.alive) continue;
        if(circleHit(b.p, b.r, e.p, e.r)){
          e.hp -= b.dmg;
          sparkle(e.p.x, e.p.y, 8);
          if(b.charged){
            b.pierce--;
            ring(e.p.x, e.p.y, e.r + 10, 0.4);
            used = b.pierce <= 0;
          } else {
            used = true;
          }
          if(e.hp <= 0) killEnemy(e);
          if(!b.charged || used) break;
        }
      }

      if(used) bullets.splice(bi,1);
    }

    // cleanup dead
    for(let i=enemies.length-1;i>=0;i--){
      if(!enemies[i].alive) enemies.splice(i,1);
    }
  }

  // ----- Player / Bullets / Drops / Particles -----
  function updatePlayer(dt){
    player.heat = clamp(player.heat - dt*CFG.heatRecover, 0, 1.3);
    player.chargedCd = Math.max(0, player.chargedCd - dt);
    player.inv = Math.max(0, player.inv - dt);

    // dash
    player.dashCd = Math.max(0, player.dashCd - dt);
    player.dashTime = Math.max(0, player.dashTime - dt);

    // movement
    const ax = (isDown("d","arrowright")?1:0) - (isDown("a","arrowleft")?1:0);
    const ay = (isDown("s","arrowdown")?1:0) - (isDown("w","arrowup")?1:0);

    const mdir = norm(vec(ax,ay));
    const accel = CFG.accel * state.up.speed;

    // dash trigger
    const wantDash = isDown("shift") && player.dashCd <= 0 && (ax!==0 || ay!==0) && !state.between;
    if(wantDash){
      player.dashCd = CFG.dashCdMs / state.up.dash;
      player.dashTime = CFG.dashMs;
      const kick = mul(mdir, 14 * state.up.dash);
      player.v = add(player.v, kick);
      ring(player.p.x, player.p.y, 26, 0.7);
      puff(player.p.x, player.p.y, 16, 10);
      msg("Dash! 💨");
    }

    // apply accel
    player.v.x = player.v.x * CFG.friction + mdir.x * accel;
    player.v.y = player.v.y * CFG.friction + mdir.y * accel;

    // speed limit
    const maxV = CFG.maxSpeed * lerp(1, 1.4, clamp(state.up.speed-1,0,1.2)/1.2);
    const vL = len(player.v);
    if(vL > maxV){
      const n = norm(player.v);
      player.v = mul(n, maxV);
    }

    player.p.x += player.v.x;
    player.p.y += player.v.y;

    // bounds
    const pad = CFG.pad;
    player.p.x = clamp(player.p.x, pad, W-pad);
    player.p.y = clamp(player.p.y, pad, H-pad);

    // facing to mouse
    const aim = sub(vec(mouse.x, mouse.y), player.p);
    player.facing = Math.atan2(aim.y, aim.x);

    // shoot
    if(mouse.down) shoot();
    if(isDown("q")) shootCharged();

    // combo decay
    state.comboTimer = Math.max(0, state.comboTimer - dt);
    if(state.comboTimer <= 0 && state.combo !== 1){
      state.combo = Math.max(1, state.combo - 1);
      state.comboTimer = state.combo > 1 ? 520 : 0;
    }
  }

  function updateBullets(){
    const t = now();
    for(let i=bullets.length-1;i>=0;i--){
      const b = bullets[i];
      b.p.x += b.v.x;
      b.p.y += b.v.y;
      if(t - b.born > b.life){ bullets.splice(i,1); continue; }
      if(b.p.x<-40||b.p.x>W+40||b.p.y<-40||b.p.y>H+40){ bullets.splice(i,1); continue; }
    }
  }

  function updateDrops(dt){
    for(let i=drops.length-1;i>=0;i--){
      const d = drops[i];
      d.t += dt;
      // bob
      const bob = Math.sin(d.t*0.006)*2.8;
      const p = vec(d.p.x, d.p.y + bob);

      if(circleHit(p, d.r, player.p, player.r+2)){
        applyDrop(d);
        drops.splice(i,1);
        continue;
      }
      if(d.t > 9000) drops.splice(i,1);
    }
  }

  function updateParticles(){
    const t = now();
    for(let i=particles.length-1;i>=0;i--){
      const p = particles[i];
      const age = t - p.born;
      if(age > p.life){ particles.splice(i,1); continue; }
      p.p.x += p.v.x; p.p.y += p.v.y;
      p.v.x *= 0.94; p.v.y *= 0.94;
    }
    for(let i=rings.length-1;i>=0;i--){
      const r = rings[i];
      const age = t - r.born;
      if(age > r.life){ rings.splice(i,1); continue; }
      r.r += 0.35;
      r.a *= 0.965;
    }
  }

  // ----- Levels -----
  function seedLevel(lv){
    enemies.length = 0;
    enemyBullets.length = 0;
    drops.length = 0;
    bullets.length = 0;

    state.progress = 0;
    state.goal = 18 + lv*10;
    state.spawnRate = clamp(1 + lv*0.12, 1, 2.4);

    // boss wave every 5 levels: spawn extra tanks
    const startN = clamp(5 + Math.floor(lv*0.7), 5, 12);
    for(let i=0;i<startN;i++) spawnEnemy(true);

    if(lv % 5 === 0){
      for(let i=0;i<2;i++){
        enemies.push({
          kind: "tank",
          p: vec(rand(80,W-80), rand(70,140)),
          v: vec(0,0),
          r: 22,
          hp: 14 + Math.floor(lv*0.6),
          spd: 1.25 + lv*0.06,
          alive: true,
          t: rand(0,1000),
          zigDir: 1,
          shootCd: 999999,
        });
      }
      msg("⚠️ Mini-jefes: ¡cuidado con los tanques!");
    } else {
      msg("Tip: junta oro y compra mejoras entre niveles 😄");
    }

    state.between = false;
  }

  function nextLevel(){
    state.between = true;
    state.paused = true;

    // reward
    const bonus = 60 + state.level*10;
    state.gold += bonus;
    msg(`Nivel completado ✅ +${bonus} oro`);

    openOverlay(
      `NIVEL ${state.level} COMPLETADO`,
      "La tienda está activa. Compra mejoras y presiona Continuar.",
      "Consejo: Cadencia + Daño = más fácil."
    );
  }

  function continueAfterShop(){
    state.paused = false;
    state.between = false;
    closeOverlay();
    state.level++;
    seedLevel(state.level);
    lastT = now();
  }

  function gameOver(){
    state.dead = true;
    state.paused = true;
    openOverlay("GAME OVER", "Presiona Reiniciar para jugar otra vez.", `Puntos: ${fmt(state.score)} • Best: ${fmt(best)}`);
    msg("Tip: compra más vida/escudo entre niveles 😉");
  }

  // ----- Drawing -----
  function drawBackground(){
    // gradient + moving stars + neon grid
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,"rgba(120,170,255,0.10)");
    g.addColorStop(1,"rgba(255,190,120,0.06)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "white";
    const t = now()*0.02;
    for(let i=0;i<46;i++){
      const x = (i*97 + t) % W;
      const y = (i*53 + 130) % H;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "rgba(120,255,170,0.75)";
    ctx.lineWidth = 1;
    const drift = (now()*0.02)%34;
    for(let x = -34 + drift; x < W; x += 34){
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for(let y = 0; y < H; y += 34){
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    const v = ctx.createRadialGradient(W*0.5, H*0.5, H*0.2, W*0.5, H*0.5, H*0.78);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(3,6,14,0.50)");
    ctx.fillStyle = v;
    ctx.fillRect(0,0,W,H);
    ctx.restore();
  }

  function drawArena(){
    ctx.save();
    const pad = CFG.pad;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 3;
    ctx.strokeRect(pad, pad, W-pad*2, H-pad*2);

    // progress bar
    const barW = W - pad*2;
    const y = pad + 2;
    const h = 10;
    const t = clamp(state.progress / state.goal, 0, 1);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(pad, y, barW, h);
    ctx.fillStyle = "rgba(120,255,170,0.60)";
    ctx.fillRect(pad, y, barW*t, h);

    ctx.restore();
  }

  function drawPlayer(){
    ctx.save();

    // inv blink
    if(player.inv > 0){
      ctx.globalAlpha = 0.55 + 0.35*Math.sin(now()*0.02);
    }

    // body
    ctx.translate(player.p.x, player.p.y);
    ctx.rotate(player.facing);

    const rr = player.r;
    const bodyGrad = ctx.createLinearGradient(-rr, -rr, rr, rr);
    bodyGrad.addColorStop(0, "rgba(150,205,255,0.95)");
    bodyGrad.addColorStop(1, "rgba(85,125,255,0.92)");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.roundRect(-rr, -rr, rr*2, rr*2, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // nose
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.roundRect(rr*0.25, -rr*0.25, rr*0.95, rr*0.5, 8);
    ctx.fill();

    ctx.restore();
    ctx.globalAlpha = 1;

    // heat bar
    const hw = rr*2.2;
    const hh = 5;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(player.p.x - hw/2, player.p.y + rr + 10, hw, hh);
    ctx.fillStyle = "rgba(255,190,120,0.85)";
    ctx.fillRect(player.p.x - hw/2, player.p.y + rr + 10, hw*clamp(player.heat,0,1), hh);

    // shield glow
    if(state.up.shield > 0){
      ctx.save();
      ctx.globalAlpha = 0.20;
      ctx.strokeStyle = "rgba(120,170,255,0.95)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(player.p.x, player.p.y, rr+10, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBullets(){
    for(const b of bullets){
      ctx.fillStyle = b.charged ? "rgba(255,240,130,0.96)" : "rgba(255,255,255,0.92)";
      ctx.beginPath();
      ctx.arc(b.p.x, b.p.y, b.r, 0, Math.PI*2);
      ctx.fill();

      ctx.globalAlpha = 0.25;
      ctx.fillStyle = b.charged ? "rgba(255,170,80,0.95)" : "rgba(120,255,170,0.95)";
      ctx.beginPath();
      ctx.arc(b.p.x, b.p.y, b.r*(b.charged ? 2 : 1.6), 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawEnemyBullets(){
    ctx.save();
    ctx.fillStyle = "rgba(255,190,120,0.95)";
    for(const b of enemyBullets){
      ctx.beginPath();
      ctx.arc(b.p.x, b.p.y, b.r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEnemies(){
    for(const e of enemies){
      if(!e.alive) continue;

      let col = "rgba(255,90,90,0.92)";
      if(e.kind === "zig") col = "rgba(255,190,120,0.92)";
      if(e.kind === "sniper") col = "rgba(160,90,255,0.90)";
      if(e.kind === "tank") col = "rgba(255,90,200,0.86)";

      ctx.save();
      const g = ctx.createRadialGradient(e.p.x - e.r*0.5, e.p.y - e.r*0.6, 1, e.p.x, e.p.y, e.r*1.15);
      g.addColorStop(0, "rgba(255,255,255,0.25)");
      g.addColorStop(1, col);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(e.p.x, e.p.y, e.r, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1.1;
      ctx.stroke();

      // eye
      const d = norm(sub(player.p, e.p));
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.arc(e.p.x + d.x*6, e.p.y + d.y*6, Math.max(2, e.r*0.22), 0, Math.PI*2);
      ctx.fill();

      // hp bar
      const w = e.r*2;
      const t = clamp(e.hp / (e.kind==="tank" ? 18 : 8), 0, 1);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(e.p.x - w/2, e.p.y + e.r + 8, w, 4);
      ctx.fillStyle = "rgba(120,255,170,0.85)";
      ctx.fillRect(e.p.x - w/2, e.p.y + e.r + 8, w*t, 4);

      ctx.restore();
    }
  }

  function drawDrops(){
    for(const d of drops){
      const bob = Math.sin(d.t*0.006)*2.8;
      const x = d.p.x, y = d.p.y + bob;

      let c = "rgba(120,255,170,0.92)", t = "+";
      if(d.type === "heal"){ c = "rgba(120,255,170,0.92)"; t = "H"; }
      if(d.type === "shield"){ c = "rgba(120,170,255,0.95)"; t = "S"; }
      if(d.type === "bomb"){ c = "rgba(255,190,120,0.95)"; t = "B"; }
      if(d.type === "gold"){ c = "rgba(255,220,120,0.95)"; t = "$"; }

      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x,y,d.r,0,Math.PI*2);
      ctx.fill();

      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.font = "bold 12px system-ui, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(t, x, y+0.5);
    }
  }

  function drawFX(){
    const t = now();

    for(const r of rings){
      const age = (t - r.born) / r.life;
      ctx.save();
      ctx.globalAlpha = r.a * (1-age);
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.p.x, r.p.y, r.r, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }

    for(const p of particles){
      const age = (t - p.born) / p.life;
      const a = p.a * (1-age);

      ctx.save();
      ctx.globalAlpha = a;

      if(p.kind === "smoke"){
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.beginPath();
        ctx.arc(p.p.x, p.p.y, p.r*(1+age*0.9), 0, Math.PI*2);
        ctx.fill();
      } else {
        ctx.fillStyle = "rgba(120,255,170,0.85)";
        ctx.fillRect(p.p.x, p.p.y, p.r, p.r);
      }

      ctx.restore();
    }
  }

  function draw(){
    // shake
    const s = state.shake;
    state.shake *= 0.92;
    if(state.shake < 0.1) state.shake = 0;

    const ox = s ? rand(-s, s) : 0;
    const oy = s ? rand(-s, s) : 0;

    ctx.save();
    ctx.setTransform(1,0,0,1,ox,oy);

    drawBackground();
    drawArena();
    drawDrops();
    drawEnemies();
    drawEnemyBullets();
    drawBullets();
    drawPlayer();
    drawFX();

    ctx.restore();
  }

  // ----- Loop -----
  let lastT = now();

  function update(dt){
    // spawn
    maybeSpawn(dt);

    // update
    updatePlayer(dt);
    updateBullets();
    updateEnemies(dt);
    updateDrops(dt);
    updateParticles();

    // level complete
    if(!state.between && state.progress >= state.goal){
      nextLevel();
    }

    // keep UI
    syncUI();
  }

  function frame(){
    requestAnimationFrame(frame);
    if(state.paused){
      draw();
      return;
    }

    const t = now();
    let dt = t - lastT;
    lastT = t;
    dt = clamp(dt, 0, 40);

    update(dt);
    draw();
  }

  // ----- Start / Restart -----
  function restart(){
    state.paused = false;
    state.between = false;
    state.dead = false;

    state.level = 1;
    state.score = 0;
    state.gold = 0;
    state.combo = 1;
    state.comboTimer = 0;
    state.progress = 0;

    state.up.maxHp = 100;
    state.up.hp = 100;
    state.up.shield = 0;
    state.up.speed = 1.0;
    state.up.dmg = 1;
    state.up.rof = 1.0;
    state.up.radius = 1.0;
    state.up.dash = 1.0;

    bullets.length = 0;
    enemies.length = 0;
    enemyBullets.length = 0;
    drops.length = 0;
    particles.length = 0;
    rings.length = 0;

    player.p = vec(W*0.5, H*0.65);
    player.v = vec(0,0);
    player.inv = 800;
    player.heat = 0;
    player.chargedCd = 0;
    player.dashCd = 0;
    player.dashTime = 0;

    state.shake = 0;

    closeOverlay();
    msg("Tip: usa dash (Shift) para sobrevivir más 😄");
    seedLevel(1);
    syncUI();

    lastT = now();
  }

  // start
  syncUI();
  msg("Tip: apunta con mouse. Click/Espacio para disparar. Shift para dash.");
  seedLevel(1);
  frame();

})();
