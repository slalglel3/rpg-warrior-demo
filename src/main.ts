/**
 * @file main.ts
 * @description Mobile-first landscape 2.5D Warrior RPG Web Demo powered by
 * `/home/slalglel/rpg-engine` (`diablo-109b-engine`), `concept-asset-studio`
 * character & UI assets, and `godot4-game-studio` kinematics & VFX.
 */

import './styles/main.css';
import { Direction, ItemType, MonMode, PlrMode, idx112 } from 'diablo-109b-engine';
import warriorPortraitPng from './assets/warrior_portrait.png';
import warriorFullPng from './assets/warrior_full.png';
import {
  SANCTUM_MAX_X,
  SANCTUM_MAX_Y,
  SANCTUM_MIN_X,
  SANCTUM_MIN_Y,
  SANCTUM_PILLARS,
  WarriorSanctumSession,
  getWarriorBlueprint,
  plrModeLabel,
} from './engine/warriorSession.js';
import { SoundSynth } from './audio/soundSynth.js';
import { SanctumRenderer } from './render/sanctumRenderer.js';

const TICK_STEP_SEC = 1 / 20; // diablo-109b-engine deterministic 20 Hz simulation tick

const SECTOR_TO_DIR = [
  Direction.DIR_E,
  Direction.DIR_SE,
  Direction.DIR_S,
  Direction.DIR_SW,
  Direction.DIR_W,
  Direction.DIR_NW,
  Direction.DIR_N,
  Direction.DIR_NE,
] as const;

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function vectorToIsoDir(sx: number, sy: number): Direction {
  const angle = Math.atan2(sy, sx);
  const sector = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  return SECTOR_TO_DIR[sector]!;
}

class WarriorDemoApp {
  private root: HTMLElement;
  private renderer = new SanctumRenderer();
  private sound = new SoundSynth();
  private session: WarriorSanctumSession | null = null;
  private latestSnapshot: ReturnType<WarriorSanctumSession['step']>['snapshot'] | null = null;

  private activeScreen: 'creation' | 'game' = 'creation';
  private activeModal: 'none' | 'stats' | 'engine' = 'none';

  // Creation preview & form state
  private heroName = '아서';
  private creationCanvas!: HTMLCanvasElement;
  private gameCanvas!: HTMLCanvasElement;
  private minimapCanvas!: HTMLCanvasElement;

  // Input state
  private keysHeld = new Set<string>();
  private joystickActive = false;
  private joystickVector = { x: 0, y: 0 };
  private joystickPointerId: number | null = null;
  private steerThrottle = 0;

  // Fixed-timestep simulation loop state
  private lastRafMs = 0;
  private simAccumulator = 0;
  private totalTimeSec = 0;
  private lastHudSyncMs = 0;

  // Cached HUD element references
  private els!: {
    rotateOverlay: HTMLElement;
    creationScreen: HTMLElement;
    gameScreen: HTMLElement;
    nameInput: HTMLInputElement;
    hudName: HTMLElement;
    hudLevel: HTMLElement;
    hudWave: HTMLElement;
    hudKills: HTMLElement;
    hudGold: HTMLElement;
    hudHpBar: HTMLElement;
    hudHpText: HTMLElement;
    hudMpBar: HTMLElement;
    hudMpText: HTMLElement;
    hudXpBar: HTMLElement;
    hudStatBtn: HTMLButtonElement;
    waveClearBtn: HTMLButtonElement;
    btnSound: HTMLButtonElement;
    btnCleave: HTMLButtonElement;
    cleaveSub: HTMLElement;
    btnPotion: HTMLButtonElement;
    potionSub: HTMLElement;
    btnInteract: HTMLButtonElement;
    interactSub: HTMLElement;
    joystickBase: HTMLElement;
    joystickKnob: HTMLElement;
    drawerStats: HTMLElement;
    drawerStatsBody: HTMLElement;
    drawerEngine: HTMLElement;
    drawerEngineBody: HTMLElement;
    deathOverlay: HTMLElement;
    deathSummary: HTMLElement;
  };

  constructor(root: HTMLElement) {
    this.root = root;
    this.renderShell();
    this.bindEvents();
    this.lastRafMs = performance.now();
    requestAnimationFrame((ts) => this.loop(ts));
  }

  private renderShell(): void {
    const bp = getWarriorBlueprint();
    const gearSummary = `${bp.startingGear.join(' · ')}`;

    this.root.innerHTML = `
      <div id="rotate-overlay">
        <div class="rotate-card">
          <div class="rotate-icon">📱</div>
          <h2 style="margin: 0 0 8px; font-size: 17px; color: var(--border-gold-bright);">가로 모드 플레이 권장</h2>
          <p style="margin: 0 0 14px; font-size: 13px; color: var(--ink-muted); line-height: 1.45;">
            이 2.5D RPG 데모는 모바일 가로 화면(Landscape)에 최적화되어 있습니다. 기기를 가로로 돌려주세요.
          </p>
          <button id="dismiss-rotate-btn" class="btn-secondary" type="button">세로 화면으로 계속 보기</button>
        </div>
      </div>

      <section id="creation-screen">
        <div class="storybook-panel creation-card">
          <div class="creation-preview-pane">
            <div class="preview-header">
              <span class="pill-badge">단일 직업 · 전사 (Warrior)</span>
              <span class="pill-badge blue">2.5D 7-Part Rig</span>
            </div>
            <canvas id="creation-canvas"></canvas>
            <div class="preview-caption">원화 기반 세피아 잉크 · 2.5D 다관절 스켈레탈 모션</div>
          </div>

          <div class="creation-form-pane">
            <div class="title-row">
              <h1>전사의 성소 · RPG 엔진 데모</h1>
              <p>
                <strong>diablo-109b-engine</strong>(20Hz 시뮬레이션)으로 구동되는 최소 공간 1직업 검증 데모입니다.
              </p>
            </div>

            <div>
              <label class="field-label" for="hero-name-input">전사 이름</label>
              <div class="name-input-row">
                <input id="hero-name-input" class="name-input" type="text" maxlength="14" value="아서" />
                <button class="preset-chip" data-preset="아서" type="button">아서</button>
                <button class="preset-chip" data-preset="가렌" type="button">가렌</button>
                <button class="preset-chip" data-preset="로한" type="button">로한</button>
              </div>
            </div>

            <div>
              <span class="field-label">엔진 초기 스탯 (PlrClass.PC_WARRIOR)</span>
              <div class="blueprint-grid">
                <div class="stat-chip"><span class="k">힘 STR</span><span class="v">${bp.str}</span></div>
                <div class="stat-chip"><span class="k">마력 MAG</span><span class="v">${bp.mag}</span></div>
                <div class="stat-chip"><span class="k">민첩 DEX</span><span class="v">${bp.dex}</span></div>
                <div class="stat-chip"><span class="k">체력 VIT</span><span class="v">${bp.vit}</span></div>
              </div>
            </div>

            <div class="gear-note">
              <span>초기 HP <strong>${bp.baseHp}</strong> · MP <strong>${bp.baseMana}</strong></span>
              <span>장비: <strong>${gearSummary}</strong></span>
            </div>

            <button id="start-game-btn" class="btn-primary" type="button">⚔️ 성소 입장 (게임 시작)</button>
          </div>
        </div>
      </section>

      <section id="game-screen" class="hidden">
        <canvas id="game-canvas"></canvas>

        <div class="hud-layer">
          <div class="storybook-panel hud-top-left">
            <img class="hud-portrait" src="${warriorPortraitPng}" alt="Warrior" />
            <div class="hud-bars">
              <div class="hud-name-line">
                <span><span id="hud-name">아서</span> · <span id="hud-level">Lv.1</span></span>
                <button id="hud-stat-pts" class="stat-pts-pill hidden" type="button">스탯 +5</button>
              </div>
              <div class="bar-track">
                <div id="hud-hp-bar" class="bar-fill hp" style="width: 100%"></div>
                <div id="hud-hp-text" class="bar-text">70 / 70</div>
              </div>
              <div class="bar-track">
                <div id="hud-mp-bar" class="bar-fill mp" style="width: 100%"></div>
                <div id="hud-mp-text" class="bar-text">10 / 10</div>
              </div>
              <div class="bar-track xp">
                <div id="hud-xp-bar" class="bar-fill xp" style="width: 0%"></div>
              </div>
              <div class="hud-meta-line">
                <span id="hud-wave">Wave 1 · 적 3</span>
                <span id="hud-kills">처치 0</span>
                <span id="hud-gold">0 G</span>
              </div>
            </div>
          </div>

          <div class="hud-top-center">
            <button id="wave-clear-btn" class="wave-clear-btn hidden" type="button">✨ 성소 정화 완료! 다음 웨이브 소환</button>
          </div>

          <div class="hud-top-right">
            <div class="hud-actions-row">
              <div class="hud-btn-strip">
                <button id="btn-open-stats" class="hud-pill-btn" type="button">캐릭터/스탯</button>
                <button id="btn-open-engine" class="hud-pill-btn" type="button">엔진 모니터</button>
                <button id="btn-sound" class="hud-pill-btn" type="button">🔊 사운드</button>
                <button id="btn-fullscreen" class="hud-pill-btn" type="button">⛶ 전체</button>
              </div>
            </div>
            <div class="minimap-box">
              <canvas id="minimap-canvas" width="96" height="68"></canvas>
            </div>
          </div>

          <div id="joystick-zone" class="joystick-zone">
            <div id="joystick-base" class="joystick-base">
              <div id="joystick-knob" class="joystick-knob"></div>
            </div>
            <div class="control-hint">드래그 / WASD / 바닥 터치</div>
          </div>

          <div class="action-pad">
            <button id="btn-interact" class="skill-btn interact disabled" type="button">
              <span>상호작용</span>
              <span id="interact-sub" class="skill-sub">E</span>
            </button>
            <button id="btn-potion" class="skill-btn potion" type="button">
              <span>물약</span>
              <span id="potion-sub" class="skill-sub">x2</span>
            </button>
            <button id="btn-cleave" class="skill-btn cleave" type="button">
              <span>강타</span>
              <span id="cleave-sub" class="skill-sub">4 MP</span>
            </button>
            <button id="btn-attack" class="skill-btn attack" type="button">
              <span>⚔️ 공격</span>
              <span class="skill-sub">Space</span>
            </button>
          </div>
        </div>
      </section>

      <div id="drawer-stats" class="modal-backdrop hidden">
        <div class="storybook-panel modal-panel">
          <div class="modal-header">
            <h2>🛡️ 전사 상태 및 장비 (Engine Character Sheet)</h2>
            <button class="btn-secondary modal-close" type="button">닫기</button>
          </div>
          <div id="drawer-stats-body" class="modal-body"></div>
        </div>
      </div>

      <div id="drawer-engine" class="modal-backdrop hidden">
        <div class="storybook-panel modal-panel">
          <div class="modal-header">
            <h2>⚙️ diablo-109b-engine 실시간 코어 모니터</h2>
            <button class="btn-secondary modal-close" type="button">닫기</button>
          </div>
          <div id="drawer-engine-body" class="modal-body"></div>
        </div>
      </div>

      <div id="death-overlay" class="modal-backdrop hidden">
        <div class="storybook-panel death-card">
          <h2 style="margin: 0 0 8px; color: #ff9c94;">전사가 쓰러졌습니다</h2>
          <p id="death-summary" style="margin: 0 0 14px; font-size: 13px; color: var(--ink-muted); line-height: 1.5;"></p>
          <div style="display: flex; gap: 8px; justify-content: center;">
            <button id="btn-respawn" class="btn-primary" type="button" style="width: auto; padding: 9px 18px;">✨ 성소에서 부활</button>
            <button id="btn-back-create" class="btn-secondary" type="button">캐릭터 재생성</button>
          </div>
        </div>
      </div>
    `;

    this.creationCanvas = document.getElementById('creation-canvas') as HTMLCanvasElement;
    this.gameCanvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;

    this.els = {
      rotateOverlay: document.getElementById('rotate-overlay')!,
      creationScreen: document.getElementById('creation-screen')!,
      gameScreen: document.getElementById('game-screen')!,
      nameInput: document.getElementById('hero-name-input') as HTMLInputElement,
      hudName: document.getElementById('hud-name')!,
      hudLevel: document.getElementById('hud-level')!,
      hudWave: document.getElementById('hud-wave')!,
      hudKills: document.getElementById('hud-kills')!,
      hudGold: document.getElementById('hud-gold')!,
      hudHpBar: document.getElementById('hud-hp-bar')!,
      hudHpText: document.getElementById('hud-hp-text')!,
      hudMpBar: document.getElementById('hud-mp-bar')!,
      hudMpText: document.getElementById('hud-mp-text')!,
      hudXpBar: document.getElementById('hud-xp-bar')!,
      hudStatBtn: document.getElementById('hud-stat-pts') as HTMLButtonElement,
      waveClearBtn: document.getElementById('wave-clear-btn') as HTMLButtonElement,
      btnSound: document.getElementById('btn-sound') as HTMLButtonElement,
      btnCleave: document.getElementById('btn-cleave') as HTMLButtonElement,
      cleaveSub: document.getElementById('cleave-sub')!,
      btnPotion: document.getElementById('btn-potion') as HTMLButtonElement,
      potionSub: document.getElementById('potion-sub')!,
      btnInteract: document.getElementById('btn-interact') as HTMLButtonElement,
      interactSub: document.getElementById('interact-sub')!,
      joystickBase: document.getElementById('joystick-base')!,
      joystickKnob: document.getElementById('joystick-knob')!,
      drawerStats: document.getElementById('drawer-stats')!,
      drawerStatsBody: document.getElementById('drawer-stats-body')!,
      drawerEngine: document.getElementById('drawer-engine')!,
      drawerEngineBody: document.getElementById('drawer-engine-body')!,
      deathOverlay: document.getElementById('death-overlay')!,
      deathSummary: document.getElementById('death-summary')!,
    };
  }

  private bindEvents(): void {
    document.getElementById('dismiss-rotate-btn')?.addEventListener('click', () => {
      this.els.rotateOverlay.classList.add('dismissed');
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.preset ?? '아서';
        this.els.nameInput.value = val;
        this.heroName = val;
      });
    });

    document.getElementById('start-game-btn')?.addEventListener('click', () => {
      this.startDemo();
    });

    this.els.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.startDemo();
      }
    });

    // HUD buttons
    document.getElementById('btn-open-stats')?.addEventListener('click', () => this.toggleModal('stats'));
    this.els.hudStatBtn.addEventListener('click', () => this.toggleModal('stats'));
    document.getElementById('btn-open-engine')?.addEventListener('click', () => this.toggleModal('engine'));

    this.els.btnSound.addEventListener('click', () => {
      this.sound.unlock();
      this.sound.setMuted(!this.sound.muted);
      this.els.btnSound.textContent = this.sound.muted ? '🔇 음소거' : '🔊 사운드';
    });

    document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
      const el = document.documentElement;
      if (!document.fullscreenElement) {
        void el.requestFullscreen?.().catch(() => {});
        try {
          void (screen.orientation as ScreenOrientation & { lock?: (m: string) => Promise<void> }).lock?.('landscape');
        } catch {
          // Ignore unsupported orientation lock
        }
      } else {
        void document.exitFullscreen?.().catch(() => {});
      }
    });

    this.els.waveClearBtn.addEventListener('click', () => {
      if (!this.session) return;
      this.sound.unlock();
      this.session.spawnWaveMonsters(this.session.wave + 1);
      this.syncHud(true);
    });

    // Combat & interaction buttons
    const triggerAttack = (e: Event) => {
      e.preventDefault();
      this.sound.unlock();
      this.session?.attackAction();
    };
    const triggerCleave = (e: Event) => {
      e.preventDefault();
      this.sound.unlock();
      this.session?.powerCleaveAction();
    };
    const triggerPotion = (e: Event) => {
      e.preventDefault();
      this.sound.unlock();
      this.session?.usePotionBeltSlot();
    };
    const triggerInteract = (e: Event) => {
      e.preventDefault();
      this.sound.unlock();
      this.session?.interactNearest();
    };

    document.getElementById('btn-attack')?.addEventListener('pointerdown', triggerAttack);
    this.els.btnCleave.addEventListener('pointerdown', triggerCleave);
    this.els.btnPotion.addEventListener('pointerdown', triggerPotion);
    this.els.btnInteract.addEventListener('pointerdown', triggerInteract);

    // Modals close & stats clicks
    this.root.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', () => this.toggleModal('none'));
    });

    [this.els.drawerStats, this.els.drawerEngine].forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) this.toggleModal('none');
      });
    });

    this.els.drawerStatsBody.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const statBtn = target.closest<HTMLButtonElement>('[data-alloc-stat]');
      if (statBtn && this.session) {
        const stat = statBtn.dataset.allocStat as 'str' | 'mag' | 'dex' | 'vit';
        this.session.allocateStat(stat);
        this.sound.playLootPop();
        this.renderStatsDrawer();
        this.syncHud(true);
        return;
      }
      if (target.closest('#btn-reset-to-create')) {
        this.returnToCreation();
      }
    });

    document.getElementById('btn-respawn')?.addEventListener('click', () => {
      this.sound.unlock();
      this.session?.respawnWarrior();
      this.els.deathOverlay.classList.add('hidden');
      this.syncHud(true);
    });

    document.getElementById('btn-back-create')?.addEventListener('click', () => {
      this.returnToCreation();
    });

    // Virtual Joystick pointer drag
    const joyZone = document.getElementById('joystick-zone')!;
    const updateJoystick = (clientX: number, clientY: number) => {
      const rect = this.els.joystickBase.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const maxR = rect.width * 0.42;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxR && dist > 0) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }
      this.els.joystickKnob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      this.joystickVector = dist > 8 ? { x: dx / maxR, y: dy / maxR } : { x: 0, y: 0 };
    };

    const resetJoystick = () => {
      this.joystickActive = false;
      this.joystickPointerId = null;
      this.joystickVector = { x: 0, y: 0 };
      this.els.joystickKnob.style.transform = 'translate(0px, 0px)';
    };

    joyZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.sound.unlock();
      this.joystickActive = true;
      this.joystickPointerId = e.pointerId;
      joyZone.setPointerCapture(e.pointerId);
      updateJoystick(e.clientX, e.clientY);
    });

    joyZone.addEventListener('pointermove', (e) => {
      if (!this.joystickActive || e.pointerId !== this.joystickPointerId) return;
      updateJoystick(e.clientX, e.clientY);
    });

    joyZone.addEventListener('pointerup', (e) => {
      if (e.pointerId === this.joystickPointerId) resetJoystick();
    });
    joyZone.addEventListener('pointercancel', resetJoystick);

    // Tap-to-walk / tap-to-attack / tap-to-loot on game canvas
    this.gameCanvas.addEventListener('pointerdown', (e) => {
      if (!this.session || this.activeScreen !== 'game' || this.activeModal !== 'none') return;
      this.sound.unlock();
      const rect = this.gameCanvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { tx, ty } = this.renderer.screenToWorld(sx, sy, rect.width, rect.height);
      const clampedX = Math.max(SANCTUM_MIN_X, Math.min(SANCTUM_MAX_X, tx));
      const clampedY = Math.max(SANCTUM_MIN_Y, Math.min(SANCTUM_MAX_Y, ty));
      this.renderer.markTapTile(clampedX, clampedY);
      this.session.walkToTile(clampedX, clampedY);
    });

    // Keyboard shortcuts (PC / tablet external keyboard testing)
    window.addEventListener('keydown', (e) => {
      if (this.activeScreen !== 'game') return;
      const code = e.code;
      this.keysHeld.add(code);
      if (code === 'Space' || code === 'Enter') {
        e.preventDefault();
        this.sound.unlock();
        this.session?.attackAction();
      } else if (code === 'KeyQ' || code === 'ShiftLeft') {
        this.sound.unlock();
        this.session?.powerCleaveAction();
      } else if (code === 'Digit1' || code === 'KeyF') {
        this.sound.unlock();
        this.session?.usePotionBeltSlot();
      } else if (code === 'KeyE') {
        this.sound.unlock();
        this.session?.interactNearest();
      } else if (code === 'KeyI') {
        this.toggleModal(this.activeModal === 'stats' ? 'none' : 'stats');
      } else if (code === 'Backquote' || code === 'KeyM') {
        this.toggleModal(this.activeModal === 'engine' ? 'none' : 'engine');
      } else if (code === 'Escape' && this.activeModal !== 'none') {
        this.toggleModal('none');
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysHeld.delete(e.code);
    });
  }

  private startDemo(): void {
    this.sound.unlock();
    this.heroName = this.els.nameInput.value.trim() || '아서';
    this.session = new WarriorSanctumSession(this.heroName);
    this.renderer = new SanctumRenderer();
    this.simAccumulator = 0;
    this.activeModal = 'none';
    this.els.deathOverlay.classList.add('hidden');
    this.els.drawerStats.classList.add('hidden');
    this.els.drawerEngine.classList.add('hidden');

    this.activeScreen = 'game';
    this.els.creationScreen.classList.add('hidden');
    this.els.gameScreen.classList.remove('hidden');

    try {
      void (screen.orientation as ScreenOrientation & { lock?: (m: string) => Promise<void> }).lock?.('landscape');
    } catch {
      // Orientation lock optional on desktop browsers
    }

    const firstStep = this.session.step(1);
    this.latestSnapshot = firstStep.snapshot;
    this.renderer.ingestCombatCues(firstStep.combatCues, this.heroName);
    this.sound.handleCombatCues(firstStep.combatCues);
    this.syncHud(true);
  }

  private returnToCreation(): void {
    this.toggleModal('none');
    this.els.deathOverlay.classList.add('hidden');
    this.activeScreen = 'creation';
    this.session = null;
    this.latestSnapshot = null;
    this.els.gameScreen.classList.add('hidden');
    this.els.creationScreen.classList.remove('hidden');
  }

  private toggleModal(modal: 'none' | 'stats' | 'engine'): void {
    this.activeModal = modal;
    this.els.drawerStats.classList.toggle('hidden', modal !== 'stats');
    this.els.drawerEngine.classList.toggle('hidden', modal !== 'engine');
    if (modal === 'stats') this.renderStatsDrawer();
    if (modal === 'engine') this.renderEngineDrawer();
  }

  private computeContinuousSteer(): Direction | null {
    if (this.joystickActive && Math.hypot(this.joystickVector.x, this.joystickVector.y) > 0.24) {
      return vectorToIsoDir(this.joystickVector.x, this.joystickVector.y);
    }
    let sx = 0;
    let sy = 0;
    if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) sx -= 1;
    if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) sx += 1;
    if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) sy -= 1;
    if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) sy += 1;
    if (sx !== 0 || sy !== 0) {
      return vectorToIsoDir(sx, sy);
    }
    return null;
  }

  private fitCanvasToDpr(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: rect.width, height: rect.height };
  }

  private loop(nowMs: number): void {
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - this.lastRafMs) / 1000));
    this.lastRafMs = nowMs;
    this.totalTimeSec += dt;

    if (this.activeScreen === 'creation') {
      this.renderCreationPreview();
    } else if (this.session) {
      // Apply directional steering smoothly before stepping fixed simulation ticks
      this.steerThrottle = Math.max(0, this.steerThrottle - dt);
      if (this.activeModal === 'none' && this.steerThrottle <= 0) {
        const steerDir = this.computeContinuousSteer();
        if (steerDir !== null && this.session.steerDirection(steerDir)) {
          this.steerThrottle = 0.085;
        }
      }

      if (!this.renderer.isInHitstop()) {
        this.simAccumulator += dt;
        let stepped = 0;
        while (this.simAccumulator >= TICK_STEP_SEC && stepped < 3) {
          const out = this.session.step(1);
          this.latestSnapshot = out.snapshot;
          this.renderer.ingestCombatCues(out.combatCues, this.heroName);
          this.sound.handleAudioCues(out.audioCues);
          this.sound.handleCombatCues(out.combatCues);
          this.simAccumulator -= TICK_STEP_SEC;
          stepped++;
        }
      }

      const snap = this.latestSnapshot;
      if (snap) {
        const details = this.session.getWarriorDetails();
        this.renderer.updateEffects(dt, snap, details.pxoff, details.pyoff);

        const fitted = this.fitCanvasToDpr(this.gameCanvas);
        if (fitted) {
          const world = this.session.ctx.world;
          this.renderer.renderScene(
            fitted.ctx,
            fitted.width,
            fitted.height,
            snap,
            details.pxoff,
            details.pyoff,
            this.totalTimeSec,
            (x, y) => world.nSolidTable[world.dPiece[idx112(x, y)]!] !== 0,
            (idx) => (world.item[idx]?._itype ?? ItemType.ITYPE_NONE) === ItemType.ITYPE_GOLD,
          );
        }

        if (nowMs - this.lastHudSyncMs >= 100) {
          this.syncHud(false);
          this.renderMinimap();
          if (this.activeModal === 'engine') this.renderEngineDrawer();
          if (this.activeModal === 'stats') this.renderStatsDrawer();
          this.lastHudSyncMs = nowMs;
        }
      }
    }

    requestAnimationFrame((ts) => this.loop(ts));
  }

  private renderCreationPreview(): void {
    const fitted = this.fitCanvasToDpr(this.creationCanvas);
    if (!fitted) return;
    const { ctx, width, height } = fitted;
    ctx.clearRect(0, 0, width, height);

    const scale = Math.min(width / 260, height / 235) * 0.72;
    const footX = width * 0.5;
    const footY = height * 0.84;

    // Warm ground contact shadow underneath preview hero
    ctx.save();
    ctx.fillStyle = 'rgba(18, 12, 24, 0.55)';
    ctx.beginPath();
    ctx.ellipse(footX, footY + 3, 52 * scale, 16 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    this.renderer.rig.render(ctx, footX, footY, scale, {
      mode: PlrMode.PM_STAND,
      dir: Direction.DIR_SE,
      animFrame: 1,
      animLen: 10,
      timeSec: this.totalTimeSec,
      hitFlash: 0,
      blockGlow: 0,
      powerCleaveTimer: 0,
    });
  }

  private syncHud(force: boolean): void {
    if (!this.session) return;
    const d = this.session.getWarriorDetails();
    const living = this.session.getLivingMonsterCount();
    const hpPct = Math.max(0, Math.min(100, (d.hp / Math.max(1, d.maxHp)) * 100));
    const mpPct = Math.max(0, Math.min(100, (d.mana / Math.max(1, d.maxMana)) * 100));
    const xpPct = Math.max(0, Math.min(100, (d.exp / Math.max(1, d.nextExp)) * 100));

    if (force) {
      this.els.hudName.textContent = d.name;
    }
    this.els.hudLevel.textContent = `Lv.${d.level}`;
    this.els.hudWave.textContent = `Wave ${this.session.wave} · 적 ${living}`;
    this.els.hudKills.textContent = `처치 ${this.session.kills}`;
    this.els.hudGold.textContent = `${d.gold} G`;

    this.els.hudHpBar.style.width = `${hpPct.toFixed(1)}%`;
    this.els.hudHpText.textContent = `${d.hp} / ${d.maxHp}`;
    this.els.hudMpBar.style.width = `${mpPct.toFixed(1)}%`;
    this.els.hudMpText.textContent = `${d.mana} / ${d.maxMana}`;
    this.els.hudXpBar.style.width = `${xpPct.toFixed(1)}%`;

    this.els.hudStatBtn.textContent = `스탯 +${d.statPts}`;
    this.els.hudStatBtn.classList.toggle('hidden', d.statPts <= 0);

    // Wave clear summon button
    const isAlive = d.mode !== PlrMode.PM_DEATH && d.hp > 0;
    this.els.waveClearBtn.classList.toggle('hidden', living > 0 || !isAlive);
    if (living === 0) {
      this.els.waveClearBtn.textContent = `✨ Wave ${this.session.wave} 정화! 다음 웨이브 소환`;
    }

    // Power Cleave cooldown
    const cd = this.session.powerCleaveCooldownTicks;
    if (cd > 0) {
      this.els.cleaveSub.textContent = `${(cd / 20).toFixed(1)}s`;
      this.els.btnCleave.classList.add('disabled');
    } else if (d.mana < 4) {
      this.els.cleaveSub.textContent = '마나부족';
      this.els.btnCleave.classList.add('disabled');
    } else {
      this.els.cleaveSub.textContent = '4 MP';
      this.els.btnCleave.classList.remove('disabled');
    }

    // Belt potions
    this.els.potionSub.textContent = `x${d.beltPotions}`;
    this.els.btnPotion.classList.toggle('disabled', d.beltPotions <= 0 || d.hp >= d.maxHp);

    // Nearby context interaction
    const interactLabel = this.session.getNearbyInteractLabel();
    this.els.btnInteract.classList.toggle('disabled', !interactLabel);
    this.els.interactSub.textContent = interactLabel ? interactLabel.slice(0, 6) : 'E';

    // Death modal
    if (!isAlive) {
      this.els.deathSummary.textContent = `Lv.${d.level} · Wave ${this.session.wave} · 누적 처치 ${this.session.kills} · ${d.gold} Gold`;
      this.els.deathOverlay.classList.remove('hidden');
    }
  }

  private renderMinimap(): void {
    if (!this.session) return;
    const ctx = this.minimapCanvas.getContext('2d');
    if (!ctx) return;

    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#171222';
    ctx.fillRect(0, 0, w, h);

    const spanX = SANCTUM_MAX_X - SANCTUM_MIN_X + 1;
    const spanY = SANCTUM_MAX_Y - SANCTUM_MIN_Y + 1;
    const toMini = (tx: number, ty: number) => ({
      x: ((tx - SANCTUM_MIN_X + 0.5) / spanX) * (w - 8) + 4,
      y: ((ty - SANCTUM_MIN_Y + 0.5) / spanY) * (h - 8) + 4,
    });

    // Arena floor frame
    ctx.strokeStyle = 'rgba(201, 154, 71, 0.45)';
    ctx.strokeRect(3, 3, w - 6, h - 6);

    // 4 Pillars
    ctx.fillStyle = '#796c87';
    for (const p of SANCTUM_PILLARS) {
      const m = toMini(p.x, p.y);
      ctx.fillRect(m.x - 2, m.y - 2, 4, 4);
    }

    const world = this.session.ctx.world;
    // Objects
    ctx.fillStyle = '#d79f44';
    for (let i = 0; i < world.nobjects; i++) {
      const obj = world.object[world.objectactive[i]!]!;
      if (obj._oSelFlag === 0) continue;
      const m = toMini(obj._ox, obj._oy);
      ctx.fillRect(m.x - 1.5, m.y - 1.5, 3, 3);
    }

    // Living monsters
    ctx.fillStyle = '#ff574e';
    for (let i = 0; i < world.nummonsters; i++) {
      const mon = world.monster[world.monstactive[i]!]!;
      if (mon._mhitpoints <= 0 || mon._mmode === MonMode.MM_DEATH) continue;
      const m = toMini(mon._mx, mon._my);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Warrior player dot
    const me = world.plr[0]!;
    const pm = toMini(me._px, me._py);
    ctx.fillStyle = '#73e28a';
    ctx.beginPath();
    ctx.arc(pm.x, pm.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderStatsDrawer(): void {
    if (!this.session) return;
    const d = this.session.getWarriorDetails();
    const canAlloc = d.statPts > 0;
    this.els.drawerStatsBody.innerHTML = `
      <div class="stats-grid">
        <div class="stats-art-box">
          <img src="${warriorFullPng}" alt="Warrior Full" />
          <strong style="color: var(--border-gold-bright); font-size: 14px;">${escapeHtml(d.name)} · Lv.${d.level}</strong>
          <span style="font-size: 11px; color: var(--ink-muted);">경험치 ${d.exp} / ${d.nextExp}</span>
          <span style="font-size: 11px; color: #f6cf7e;">보유 골드: ${d.gold} G · 남은 포인트: ${d.statPts}</span>
        </div>
        <div>
          <div class="attr-row">
            <span>힘 (Strength) · 공격력 향상</span>
            <span><strong>${d.str}</strong> <button class="attr-plus-btn" data-alloc-stat="str" ${canAlloc ? '' : 'disabled'}>+1</button></span>
          </div>
          <div class="attr-row">
            <span>마력 (Magic) · 최대 마나 향상</span>
            <span><strong>${d.mag}</strong> <button class="attr-plus-btn" data-alloc-stat="mag" ${canAlloc ? '' : 'disabled'}>+1</button></span>
          </div>
          <div class="attr-row">
            <span>민첩 (Dexterity) · 명중/AC/방패막기</span>
            <span><strong>${d.dex}</strong> <button class="attr-plus-btn" data-alloc-stat="dex" ${canAlloc ? '' : 'disabled'}>+1</button></span>
          </div>
          <div class="attr-row">
            <span>체력 (Vitality) · 최대 생명력</span>
            <span><strong>${d.vit}</strong> <button class="attr-plus-btn" data-alloc-stat="vit" ${canAlloc ? '' : 'disabled'}>+1</button></span>
          </div>
          <div class="attr-row"><span>전투 피해 / 방어도 (AC)</span><strong>${d.minDmg}–${d.maxDmg} DMG · ${d.ac} AC</strong></div>
          <div class="attr-row"><span>왼손 무기 · 오른손 방패</span><strong>${escapeHtml(d.weaponName)} · ${escapeHtml(d.shieldName)}</strong></div>
          <div style="margin-top: 8px; display: flex; justify-content: flex-end;">
            <button id="btn-reset-to-create" class="btn-secondary" type="button">캐릭터 생성 화면으로</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderEngineDrawer(): void {
    if (!this.session) return;
    const diag = this.session.getDiagnostics();
    const h = diag.hookStats;
    this.els.drawerEngineBody.innerHTML = `
      <div class="engine-grid">
        <div class="engine-kv"><span class="k">Engine Tick (20Hz)</span><span class="v">#${diag.tick} (${diag.clockMs}ms)</span></div>
        <div class="engine-kv"><span class="k">Player Mode / Frame</span><span class="v">${plrModeLabel(diag.playerMode)} [f:${diag.animFrame}]</span></div>
        <div class="engine-kv"><span class="k">Tile / Sub-Offset</span><span class="v">(${diag.playerPos.x},${diag.playerPos.y}) off(${diag.playerPos.xoff},${diag.playerPos.yoff})</span></div>
        <div class="engine-kv"><span class="k">Dir / Walk Queue</span><span class="v">DIR_${diag.playerDir} · A* ${diag.walkQueueLength} steps</span></div>
        <div class="engine-kv"><span class="k">Active Entities</span><span class="v">Mon:${diag.activeMonsters} · Obj:${diag.activeObjects} · Item:${diag.activeItems}</span></div>
        <div class="engine-kv"><span class="k">Combat Hooks</span><span class="v">Hit:${h.mStartHit} Kill:${h.mStartKill} Blk:${h.startPlrBlock} Hurt:${h.startPlrHit}</span></div>
        <div class="engine-kv"><span class="k">World Hooks</span><span class="v">OpObj:${h.operateObject} Brk:${h.breakObject} Drop:${h.spawnItem} Pick:${h.autoGetItem}</span></div>
        <div class="engine-kv"><span class="k">Engine Core Lock</span><span class="v">Read-Only /rpg-engine OK</span></div>
        <div class="engine-kv"><span class="k">Arena Bounds</span><span class="v">${SANCTUM_MIN_X}..${SANCTUM_MAX_X} x ${SANCTUM_MIN_Y}..${SANCTUM_MAX_Y}</span></div>
      </div>
      <div class="field-label">최근 엔진 이벤트 로그</div>
      <div class="event-log-box">${diag.recentEvents.length > 0 ? diag.recentEvents.map((e) => `<div>• ${escapeHtml(e)}</div>`).join('') : '<div>(이벤트 대기 중...)</div>'}</div>
    `;
  }
}

const mount = document.getElementById('app');
if (mount) {
  new WarriorDemoApp(mount);
}
