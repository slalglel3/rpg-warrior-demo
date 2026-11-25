/**
 * @file warriorSession.ts
 * @description Downstream game-layer adapter binding `/home/slalglel/rpg-engine` (`diablo-109b-engine`,
 * strictly Read-Only) to a compact 2.5D Warrior Sanctum demo. Wires Phase 5+6 `PlayerHooks`,
 * stamps a compact 18x18 stone sanctum inside `WorldState`, drives 20 Hz `GameEngine` ticks,
 * and exposes `RenderSnapshot`, `AudioCue[]`, `CombatCue[]`, and live `EngineDiagnostics`.
 */

import {
  ActionId,
  CmdId,
  CursorId,
  DFlag,
  Difficulty,
  Direction,
  DungeonType,
  InvBodyLoc,
  InvItem,
  ItemType,
  LvlEntry,
  MAXDUNX,
  MAXDUNY,
  MAXITEMS,
  MAXMONSTERS,
  MAXOBJECTS,
  MAXTILES,
  MonMode,
  MonsterId,
  ObjectId,
  PlaceFlag,
  PlrClass,
  PlrMode,
  getDirection,
  i32,
  sar32,
} from 'diablo-109b-engine';
import {
  GameEngine,
  buildRenderSnapshot,
  createEngineContext,
  drainEngineEvents,
  extractAudioCues,
  type AudioCue,
  type EngineContext,
  type EngineEvent,
  type LevelAssetBundle,
  type RenderSnapshot,
} from 'diablo-109b-engine';
import {
  addDead,
  addMissile,
  addMonster,
  addMonsterType,
  addObject,
  addPlrMonstExper,
  autoGetItem,
  breakObject,
  calcPlrInv,
  clearMissileSpot,
  clrPlrPath,
  createPlayer,
  createRndItem,
  createRndUseful,
  createTypeItem,
  deleteMissile,
  deleteMonsterList,
  findGetItem,
  initDead,
  initLevelMonsters,
  initObjects,
  initPlayer,
  mGetKnockback,
  mStartHit,
  mStartKill,
  operateObject,
  placePlayer,
  plrHitMonst,
  respawnItem,
  setPlrAnims,
  spawnItem,
  spawnUnique,
  startAttack,
  startPlrBlock,
  startPlrHit,
  syncGetItem,
  syncPlrKill,
  talkToTowner,
  talktoMonster,
  tryDisarm,
  useInvItem,
  type PlayerHooks,
} from 'diablo-109b-engine';
import {
  DexterityTbl,
  MagicTbl,
  StrengthTbl,
  VitalityTbl,
  offset_x,
  offset_y,
} from 'diablo-109b-engine';
import {
  doLighting,
  doVision,
  idx112,
  idx40,
  inBounds112,
  savePreLighting,
} from 'diablo-109b-engine';
import {
  initLevelCursor,
  netSendCmdLoc,
  netSendCmdLocParam1,
  netSendCmdParam1,
} from 'diablo-109b-engine';

export const SANCTUM_MIN_X = 41;
export const SANCTUM_MAX_X = 58;
export const SANCTUM_MIN_Y = 41;
export const SANCTUM_MAX_Y = 58;
export const WARRIOR_SPAWN_X = 48;
export const WARRIOR_SPAWN_Y = 51;

export const SANCTUM_PILLARS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 45, y: 46 },
  { x: 54, y: 46 },
  { x: 45, y: 54 },
  { x: 54, y: 54 },
];

export interface CombatCue {
  id: number;
  kind:
    | 'damage_monster'
    | 'kill_monster'
    | 'damage_player'
    | 'block_player'
    | 'power_cleave'
    | 'level_up'
    | 'heal'
    | 'loot'
    | 'object_break'
    | 'wave_spawn';
  x: number;
  y: number;
  value?: number;
  label?: string;
}

export interface EngineDiagnostics {
  tick: number;
  clockMs: number;
  playerPos: { x: number; y: number; futX: number; futY: number; xoff: number; yoff: number };
  playerMode: number;
  playerModeName: string;
  playerDir: number;
  animFrame: number;
  walkQueueLength: number;
  activeMonsters: number;
  activeObjects: number;
  activeItems: number;
  hookStats: {
    mStartHit: number;
    mStartKill: number;
    startPlrHit: number;
    startPlrBlock: number;
    spawnItem: number;
    operateObject: number;
    breakObject: number;
    autoGetItem: number;
  };
  recentEvents: string[];
}

export interface WarriorBaseBlueprint {
  className: string;
  classId: number;
  str: number;
  mag: number;
  dex: number;
  vit: number;
  baseHp: number;
  baseMana: number;
  startingGear: readonly string[];
}

export function getWarriorBlueprint(): WarriorBaseBlueprint {
  const c = PlrClass.PC_WARRIOR;
  const str = StrengthTbl[c] ?? 30;
  const mag = MagicTbl[c] ?? 10;
  const dex = DexterityTbl[c] ?? 20;
  const vit = VitalityTbl[c] ?? 25;
  return {
    className: '전사 (Warrior)',
    classId: c,
    str,
    mag,
    dex,
    vit,
    baseHp: (vit + 10) * 2,
    baseMana: mag,
    startingGear: ['Short Sword (단검/직검)', 'Buckler (방패)', 'Minor Healing Potion x2'],
  };
}

function buildMinimalSanctumBundle(): LevelAssetBundle {
  const tileCount = MAXTILES + 1;
  const solidTable = new Uint8Array(tileCount);
  const transTable = new Uint8Array(tileCount);
  const missileTable = new Uint8Array(tileCount);
  const trapTable = new Uint8Array(tileCount);
  const blockTable = new Uint8Array(tileCount);

  // Tile 0: void/blocked, Tile 1: passable stone floor, Tile 2: solid wall/pillar
  solidTable[0] = 1;
  blockTable[0] = 1;
  missileTable[0] = 1;

  solidTable[1] = 0;
  transTable[1] = 0;
  missileTable[1] = 0;
  blockTable[1] = 0;

  solidTable[2] = 1;
  transTable[2] = 0;
  missileTable[2] = 1;
  blockTable[2] = 1;

  return {
    sol: {
      tileCount: MAXTILES,
      raw: new Uint8Array(MAXTILES),
      solidTable,
      transTable,
      missileTable,
      trapTable,
      blockTable,
      blockLvid: new Uint8Array(tileCount),
    },
    min: new Uint16Array(128 * 16),
    amp: new Uint16Array(64),
  };
}

export function plrModeLabel(mode: number): string {
  switch (mode) {
    case PlrMode.PM_STAND:
      return 'PM_STAND';
    case PlrMode.PM_WALK:
      return 'PM_WALK';
    case PlrMode.PM_WALK2:
      return 'PM_WALK2';
    case PlrMode.PM_WALK3:
      return 'PM_WALK3';
    case PlrMode.PM_ATTACK:
      return 'PM_ATTACK';
    case PlrMode.PM_RATTACK:
      return 'PM_RATTACK';
    case PlrMode.PM_BLOCK:
      return 'PM_BLOCK';
    case PlrMode.PM_GOTHIT:
      return 'PM_GOTHIT';
    case PlrMode.PM_DEATH:
      return 'PM_DEATH';
    case PlrMode.PM_SPELL:
      return 'PM_SPELL';
    default:
      return `PM_${mode}`;
  }
}

export class WarriorSanctumSession {
  readonly ctx: EngineContext;
  readonly engine: GameEngine;
  wave = 1;
  kills = 0;
  powerCleaveCooldownTicks = 0;
  private pendingPowerCleave = false;
  private lastLevel = 1;
  private cueSeq = 1;
  private cues: CombatCue[] = [];
  private eventLog: string[] = [];
  private hookStats = {
    mStartHit: 0,
    mStartKill: 0,
    startPlrHit: 0,
    startPlrBlock: 0,
    spawnItem: 0,
    operateObject: 0,
    breakObject: 0,
    autoGetItem: 0,
  };

  constructor(heroName: string, seed = 0x20261125) {
    const cleanName = heroName.trim().slice(0, 18) || '아서';
    const bundle = buildMinimalSanctumBundle();

    this.ctx = createEngineContext({
      gbMaxPlayers: 1,
      difficulty: Difficulty.DIFF_NORMAL,
      assetsResolver: () => bundle,
    });

    const world = this.ctx.world;
    createPlayer(world, 0, PlrClass.PC_WARRIOR, {}, seed);
    initPlayer(world, 0, true);
    const me = world.plr[0]!;
    me.plractive = true;
    me._pName = cleanName;
    me.plrlevel = 1;
    world.gbRunGame = true;
    world.gbActivePlayers = 1;
    world.myplr = 0;

    this.engine = new GameEngine(this.ctx);
    this.engine.loadLevel(1, true, LvlEntry.ENTRY_MAIN, bundle);

    this.wireExtendedEntityHooks();
    this.setupCompactSanctum();
    this.lastLevel = me._pLevel;
    this.logEvent(`Warrior "${cleanName}" created via diablo-109b-engine (Level 1 Sanctum)`);
  }

  private logEvent(msg: string): void {
    this.eventLog.unshift(`[T${this.ctx.gnFrameCount}] ${msg}`);
    if (this.eventLog.length > 24) {
      this.eventLog.length = 24;
    }
  }

  private pushCue(cue: Omit<CombatCue, 'id'>): void {
    this.cues.push({ id: this.cueSeq++, ...cue });
  }

  private wireExtendedEntityHooks(): void {
    const base = this.ctx.hooks!;
    const ctx = this.ctx;

    const fullHooks: PlayerHooks = {
      ...base,
      calcPlrInv: (w, pnum, loadGfx) => calcPlrInv(w, pnum, loadGfx, fullHooks),
      addDead: (w, x, y, dv, dir) => addDead(w, x, y, dv, dir),
      deleteMonsterList: (w) => deleteMonsterList(w),
      mGetKnockback: (w, m) => mGetKnockback(w, m),
      mStartHit: (w, m, pnum, dam) => {
        this.hookStats.mStartHit++;
        const mon = w.monster[m];
        const dmgVal = Math.max(1, sar32(dam, 6));
        if (mon) {
          this.pushCue({
            kind: 'damage_monster',
            x: mon._mx,
            y: mon._my,
            value: dmgVal,
            label: `-${dmgVal}`,
          });
          this.logEvent(`Hit ${mon.mName} for ${dmgVal} dmg`);
        }
        mStartHit(w, m, pnum, dam, fullHooks);
      },
      mStartKill: (w, m, pnum) => {
        this.hookStats.mStartKill++;
        const mon = w.monster[m];
        if (mon) {
          this.kills++;
          this.pushCue({
            kind: 'kill_monster',
            x: mon._mx,
            y: mon._my,
            value: mon.mExp,
            label: `${mon.mName} 처치! +${mon.mExp} XP`,
          });
          this.logEvent(`Killed ${mon.mName} (+${mon.mExp} XP)`);
        }
        mStartKill(w, m, pnum, fullHooks);
      },
      addPlrMonstExper: (w, lvl, exp, pmask) => {
        addPlrMonstExper(w, lvl, exp, pmask, fullHooks);
      },
      startPlrHit: (w, pnum, dam, forcehit) => {
        this.hookStats.startPlrHit++;
        const p = w.plr[pnum]!;
        const dmgVal = Math.max(1, sar32(dam, 6));
        this.pushCue({
          kind: 'damage_player',
          x: p._px,
          y: p._py,
          value: dmgVal,
          label: `-${dmgVal}`,
        });
        this.logEvent(`Warrior hit for ${dmgVal} dmg`);
        startPlrHit(w, pnum, dam, forcehit, fullHooks);
      },
      startPlrBlock: (w, pnum, dir) => {
        this.hookStats.startPlrBlock++;
        const p = w.plr[pnum]!;
        this.pushCue({
          kind: 'block_player',
          x: p._px,
          y: p._py,
          label: '방패 막기!',
        });
        this.logEvent('Shield Block triggered!');
        startPlrBlock(w, pnum, dir, fullHooks);
      },
      syncPlrKill: (w, pnum, earflag) => {
        syncPlrKill(w, pnum, earflag, fullHooks);
        this.logEvent('Warrior defeated (PM_DEATH)');
      },
      breakObject: (w, pnum, oi) => {
        this.hookStats.breakObject++;
        const obj = w.object[oi];
        breakObject(w, pnum, oi, fullHooks);
        if (obj) {
          this.pushCue({
            kind: 'object_break',
            x: obj._ox,
            y: obj._oy,
            label: '파괴!',
          });
          this.logEvent(`Object #${oi} broken`);
        }
      },
      operateObject: (w, pnum, oi, tk) => {
        this.hookStats.operateObject++;
        const obj = w.object[oi];
        operateObject(w, pnum, oi, tk, fullHooks);
        if (obj) {
          this.pushCue({
            kind: 'loot',
            x: obj._ox,
            y: obj._oy,
            label: '상자/성소 작동!',
          });
          this.logEvent(`Operated object #${oi}`);
        }
      },
      tryDisarm: (w, pnum, oi) => tryDisarm(w, pnum, oi, fullHooks),
      addMissile: (w, sx, sy, dx, dy, midir, mitype, micaster, misource, midam, spllvl) =>
        addMissile(w, sx, sy, dx, dy, midir, mitype, micaster, misource, midam, spllvl, fullHooks),
      clearMissileSpot: (w, mi) => clearMissileSpot(w, mi),
      deleteMissile: (w, mi, idx) => deleteMissile(w, mi, idx),
      spawnItem: (w, m, x, y, sendmsg) => {
        this.hookStats.spawnItem++;
        spawnItem(w, m, x, y, sendmsg, fullHooks);
      },
      createRndItem: (w, x, y, og, sm, delta) => createRndItem(w, x, y, og, sm, delta, fullHooks),
      createRndUseful: (w, pnum, x, y, sm) => createRndUseful(w, pnum, x, y, sm, fullHooks),
      createTypeItem: (w, x, y, og, itype, imisc, sm, delta) =>
        createTypeItem(w, x, y, og, itype, imisc, sm, delta, fullHooks),
      spawnUnique: (w, uid, x, y) => spawnUnique(w, uid, x, y),
      respawnItem: (w, ii, flip) => respawnItem(w, ii, flip, fullHooks),
      findGetItem: (w, idx, ci, seed) => findGetItem(w, idx, ci, seed),
      syncGetItem: (w, x, y, idx, ci, seed) => syncGetItem(w, x, y, idx, ci, seed, fullHooks),
      talkToMonster: (w, m) => talktoMonster(w, m),
      talkToTowner: (w, pnum, t) => talkToTowner(w, pnum, t, fullHooks),
      netSendCmd: (w, cmd, ...args) => {
        if (cmd === CmdId.CMD_REQUESTGITEM || cmd === CmdId.CMD_REQUESTAGITEM) {
          const pnum = args[1] ?? w.myplr;
          const itemIdx = args[2] ?? -1;
          if (itemIdx >= 0 && itemIdx < MAXITEMS) {
            this.hookStats.autoGetItem++;
            const it = w.item[itemIdx]!;
            const name = it._iIdentified ? it._iIName : it._iName;
            autoGetItem(w, pnum, itemIdx, fullHooks);
            this.pushCue({
              kind: 'loot',
              x: it._ix,
              y: it._iy,
              label: `${name || '아이템'} 획득`,
            });
            this.logEvent(`Picked up ${name || 'item'}`);
          }
          return;
        }
        // In single-player mode, entity subsystems emit sync broadcasts after mutating local state.
        // Only action commands belong on the single-player input queue; ignore outbound MP sync packets
        // so dispatchHookNetCmd never encodes 22/30-byte structs as 3-byte TCmdParam1.
        const spActionCmds = new Set<number>([
          CmdId.CMD_WALKXY,
          CmdId.CMD_ATTACKXY,
          CmdId.CMD_SATTACKXY,
          CmdId.CMD_RATTACKXY,
          CmdId.CMD_OPOBJXY,
          CmdId.CMD_DISARMXY,
          CmdId.CMD_TALKXY,
          CmdId.CMD_OPOBJT,
          CmdId.CMD_KNOCKBACK,
        ]);
        if (!spActionCmds.has(cmd)) {
          return;
        }
        base.netSendCmd?.(w, cmd, ...args);
      },
    };

    ctx.hooks = fullHooks;
  }

  private setupCompactSanctum(): void {
    const world = this.ctx.world;
    const hooks = this.ctx.hooks!;

    world.currlevel = 1;
    world.leveltype = DungeonType.DTYPE_CATHEDRAL;
    world.dminx = SANCTUM_MIN_X - 1;
    world.dminy = SANCTUM_MIN_Y - 1;
    world.dmaxx = SANCTUM_MAX_X + 2;
    world.dmaxy = SANCTUM_MAX_Y + 2;

    world.dPiece.fill(2);
    world.dTransVal.fill(0);
    world.dFlags.fill(0);
    world.dPlayer.fill(0);
    world.dMonster.fill(0);
    world.dObject.fill(0);
    world.dItem.fill(0);
    world.dDead.fill(0);

    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        world.dungeon[idx40(x, y)] = 0;
      }
    }

    for (let x = SANCTUM_MIN_X; x <= SANCTUM_MAX_X; x++) {
      for (let y = SANCTUM_MIN_Y; y <= SANCTUM_MAX_Y; y++) {
        const idx = idx112(x, y);
        world.dPiece[idx] = 1;
        world.dTransVal[idx] = 1;
        world.dFlags[idx] = DFlag.BFLAG_LIT | DFlag.BFLAG_EXPLORED;
      }
    }
    world.TransList[1] = 1;

    for (const pil of SANCTUM_PILLARS) {
      world.dPiece[idx112(pil.x, pil.y)] = 2;
    }

    // Place Warrior cleanly inside Sanctum and initialize Dungeon animations + equipped gear stats
    const me = world.plr[0]!;
    me._px = WARRIOR_SPAWN_X;
    me._py = WARRIOR_SPAWN_Y;
    me._pfutx = WARRIOR_SPAWN_X;
    me._pfuty = WARRIOR_SPAWN_Y;
    me._poldx = WARRIOR_SPAWN_X;
    me._poldy = WARRIOR_SPAWN_Y;
    me._pdir = Direction.DIR_SE;
    me._pmode = PlrMode.PM_STAND;
    world.dPlayer[idx112(me._px, me._py)] = 1;
    world.ViewX = me._px;
    world.ViewY = me._py;
    calcPlrInv(world, 0, true, hooks);
    setPlrAnims(world, 0);

    // Place interactive Sanctum objects via engine's real Object subsystem (clean slate first)
    initObjects(world, hooks);
    world.nobjects = 0;
    world.dObject.fill(0);
    for (let i = 0; i < MAXOBJECTS; i++) {
      world.objectavail[i] = i;
    }
    addObject(world, ObjectId.OBJ_BARREL, 44, 49, hooks);
    addObject(world, ObjectId.OBJ_BARREL, 53, 52, hooks);
    addObject(world, ObjectId.OBJ_CHEST1, 49, 44, hooks);
    for (let i = 0; i < world.nobjects; i++) {
      const oi = world.objectactive[i]!;
      const obj = world.object[oi]!;
      if (inBounds112(obj._ox, obj._oy)) {
        const oiIdx = idx112(obj._ox, obj._oy);
        world.dFlags[oiIdx] = (world.dFlags[oiIdx] ?? 0) | DFlag.BFLAG_LIT;
      }
    }

    initDead(world);
    this.spawnWaveMonsters(1);
    savePreLighting(world);
    doLighting(world, me._px, me._py, me._pLightRad, -1);
    doVision(world, me._px, me._py, me._pLightRad, true, true);
    initLevelCursor(this.ctx);
    world.pcurs = CursorId.CURSOR_HAND;
  }

  spawnWaveMonsters(waveNum = this.wave): void {
    const world = this.ctx.world;
    this.wave = waveNum;

    initLevelMonsters(world);
    world.dMonster.fill(0);

    const zombIdx = addMonsterType(world, MonsterId.MT_NZOMBIE, PlaceFlag.PLACE_SCATTER);
    const fallIdx = addMonsterType(world, MonsterId.MT_RFALLSD, PlaceFlag.PLACE_SCATTER);
    const skelIdx = addMonsterType(world, MonsterId.MT_WSKELSD, PlaceFlag.PLACE_SCATTER);

    const spawns: Array<{ x: number; y: number; typeIdx: number; boostHp?: number; name?: string }> =
      waveNum === 1
        ? [
            { x: 52, y: 49, typeIdx: fallIdx },
            { x: 51, y: 53, typeIdx: zombIdx },
            { x: 55, y: 49, typeIdx: skelIdx },
          ]
        : [
            { x: 52, y: 48, typeIdx: fallIdx },
            { x: 52, y: 53, typeIdx: skelIdx },
            { x: 46, y: 48, typeIdx: zombIdx },
            {
              x: 55,
              y: 50,
              typeIdx: skelIdx,
              boostHp: (14 + waveNum * 6) << 6,
              name: `Sanctum Guard Lv.${waveNum}`,
            },
          ];

    for (const sp of spawns) {
      if (!inBounds112(sp.x, sp.y) || world.dPiece[idx112(sp.x, sp.y)] !== 1) continue;
      if (world.dPlayer[idx112(sp.x, sp.y)] !== 0) continue;
      const mi = addMonster(world, sp.x, sp.y, Direction.DIR_SW, sp.typeIdx, true);
      if (mi >= 0) {
        const mon = world.monster[mi]!;
        if (sp.boostHp) {
          mon._mmaxhp = sp.boostHp;
          mon._mhitpoints = sp.boostHp;
        }
        if (sp.name) {
          mon.mName = sp.name;
        }
        mon._msquelch = 255;
        const mIdx = idx112(sp.x, sp.y);
        world.dFlags[mIdx] = (world.dFlags[mIdx] ?? 0) | DFlag.BFLAG_LIT;
      }
    }

    this.pushCue({
      kind: 'wave_spawn',
      x: world.plr[0]!._px,
      y: world.plr[0]!._py,
      value: waveNum,
      label: `제 ${waveNum} 웨이브 출현!`,
    });
    this.logEvent(`Wave ${waveNum} spawned (${world.nummonsters} monsters)`);
  }

  /** Advances the simulation by `ticks` 20 Hz steps and drains audio/combat cues. */
  step(ticks = 1): { snapshot: RenderSnapshot; audioCues: AudioCue[]; combatCues: CombatCue[]; events: EngineEvent[] } {
    const world = this.ctx.world;
    const me = world.plr[0]!;

    for (let t = 0; t < ticks; t++) {
      if (this.powerCleaveCooldownTicks > 0) {
        this.powerCleaveCooldownTicks--;
      }

      // Downstream single-player loopback: rpg-engine's nthreadSendAndRecvTurn flushes
      // pendingLocalCmds without forwarding to megaPackets in gbMaxPlayers===1, so route
      // local commands into megaPackets before stepTick() so msgProcessNetPackets parses them.
      if (this.ctx.pendingLocalCmds.length > 0) {
        this.ctx.megaPackets.push(new Uint8Array([CmdId.FAKE_CMD_SETID, world.myplr]));
        for (const cmd of this.ctx.pendingLocalCmds) {
          this.ctx.megaPackets.push(cmd);
        }
        this.ctx.pendingLocalCmds.length = 0;
      }

      this.engine.stepTick();

      // Re-light sanctum cleanly around warrior so engine monster/cursor vision checks stay active
      for (let x = SANCTUM_MIN_X; x <= SANCTUM_MAX_X; x++) {
        for (let y = SANCTUM_MIN_Y; y <= SANCTUM_MAX_Y; y++) {
          const lIdx = idx112(x, y);
          world.dFlags[lIdx] = (world.dFlags[lIdx] ?? 0) | DFlag.BFLAG_LIT;
        }
      }

      // Trigger Power Cleave AoE at the authentic Warrior swing hit frame
      if (this.pendingPowerCleave && me._pmode === PlrMode.PM_ATTACK && me._pAnimFrame >= me._pAFNum) {
        this.pendingPowerCleave = false;
        this.resolvePowerCleaveAoE();
      } else if (this.pendingPowerCleave && me._pmode !== PlrMode.PM_ATTACK) {
        this.pendingPowerCleave = false;
      }

      if (me._pLevel > this.lastLevel) {
        this.lastLevel = me._pLevel;
        this.pushCue({
          kind: 'level_up',
          x: me._px,
          y: me._py,
          value: me._pLevel,
          label: `LEVEL UP! Lv.${me._pLevel}`,
        });
        this.logEvent(`Level Up -> Lv.${me._pLevel} (+5 Stat Pts)`);
      }

      // Gentle passive warrior spirit mana regen every ~2 seconds (1 mana per 40 ticks)
      if (this.ctx.gnFrameCount % 40 === 0 && me._pMana < me._pMaxMana && me._pHitPoints > 0) {
        me._pMana = Math.min(me._pMaxMana, i32(me._pMana + 64));
        me._pManaBase = Math.min(me._pMaxManaBase, i32(me._pManaBase + 64));
      }
    }

    const events = drainEngineEvents(this.ctx);
    const audioCues = extractAudioCues(events);
    const combatCues = this.cues;
    this.cues = [];

    const snapshot = buildRenderSnapshot(this.ctx, { drainEvents: false });
    return { snapshot, audioCues, combatCues, events };
  }

  private resolvePowerCleaveAoE(): void {
    const world = this.ctx.world;
    const hooks = this.ctx.hooks!;
    const me = world.plr[0]!;

    this.pushCue({
      kind: 'power_cleave',
      x: me._px,
      y: me._py,
      label: '천둥 강타!!',
    });

    for (let i = 0; i < world.nummonsters; i++) {
      const mi = world.monstactive[i]!;
      const mon = world.monster[mi]!;
      if (sar32(mon._mhitpoints, 6) <= 0) continue;
      const dist = Math.max(Math.abs(mon._mx - me._px), Math.abs(mon._my - me._py));
      if (dist <= 2) {
        plrHitMonst(world, 0, mi, hooks);
        if (sar32(mon._mhitpoints, 6) > 0) {
          mGetKnockback(world, mi);
        }
      }
    }
  }

  /** Walks the Warrior to dungeon tile `(tx, ty)` using real `CMD_WALKXY` + A* `makePlrPath`. */
  walkToTile(tx: number, ty: number): boolean {
    const world = this.ctx.world;
    const me = world.plr[0]!;
    if (me._pmode === PlrMode.PM_DEATH) return false;

    const cx = Math.max(SANCTUM_MIN_X, Math.min(SANCTUM_MAX_X, Math.round(tx)));
    const cy = Math.max(SANCTUM_MIN_Y, Math.min(SANCTUM_MAX_Y, Math.round(ty)));

    // If tapping a living monster tile, issue CMD_ATTACKID directly
    const dm = world.dMonster[idx112(cx, cy)]!;
    if (dm !== 0) {
      const mi = dm > 0 ? dm - 1 : -(dm + 1);
      const mon = world.monster[mi];
      if (mon && sar32(mon._mhitpoints, 6) > 0) {
        netSendCmdParam1(this.ctx, true, CmdId.CMD_ATTACKID, mi);
        return true;
      }
    }

    // If tapping an interactive ground item, issue CMD_GOTOGETITEM
    const di = world.dItem[idx112(cx, cy)]!;
    if (di > 0) {
      netSendCmdLocParam1(this.ctx, true, CmdId.CMD_GOTOGETITEM, cx, cy, di - 1);
      return true;
    }

    // If tapping an interactive object, issue CMD_OPOBJXY
    const dobj = world.dObject[idx112(cx, cy)]!;
    if (dobj !== 0) {
      const oi = dobj > 0 ? dobj - 1 : -(dobj + 1);
      if (world.object[oi]?._oSelFlag) {
        netSendCmdLocParam1(this.ctx, true, CmdId.CMD_OPOBJXY, cx, cy, oi);
        return true;
      }
    }

    if (cx === me._pfutx && cy === me._pfuty) return false;
    netSendCmdLoc(this.ctx, true, CmdId.CMD_WALKXY, cx, cy);
    return true;
  }

  /** Step one tile in an isometric `Direction` (`0..7`), ideal for virtual joystick / WASD steering. */
  steerDirection(dir: Direction | number): boolean {
    const world = this.ctx.world;
    const me = world.plr[0]!;
    if (me._pmode === PlrMode.PM_DEATH) return false;
    // Allow responsive steering once current tile step finishes or while standing
    if (me._pmode !== PlrMode.PM_STAND && me.walkpath[0] !== -1) {
      return false;
    }
    const nx = me._pfutx + (offset_x[dir] ?? 0);
    const ny = me._pfuty + (offset_y[dir] ?? 0);
    if (!inBounds112(nx, ny) || world.nSolidTable[world.dPiece[idx112(nx, ny)]!] !== 0) {
      // Slide cleanly along X or Y if hitting diagonal wall/pillar
      const altX = me._pfutx + (offset_x[dir] ?? 0);
      const altY = me._pfuty;
      if (altX !== me._pfutx && world.nSolidTable[world.dPiece[idx112(altX, altY)]!] === 0) {
        netSendCmdLoc(this.ctx, true, CmdId.CMD_WALKXY, altX, altY);
        return true;
      }
      const altX2 = me._pfutx;
      const altY2 = me._pfuty + (offset_y[dir] ?? 0);
      if (altY2 !== me._pfuty && world.nSolidTable[world.dPiece[idx112(altX2, altY2)]!] === 0) {
        netSendCmdLoc(this.ctx, true, CmdId.CMD_WALKXY, altX2, altY2);
        return true;
      }
      return false;
    }
    netSendCmdLoc(this.ctx, true, CmdId.CMD_WALKXY, nx, ny);
    return true;
  }

  /** Performs melee attack against nearest monster (or swings in facing direction). */
  attackAction(): boolean {
    const world = this.ctx.world;
    const me = world.plr[0]!;
    if (
      me._pmode === PlrMode.PM_DEATH ||
      me._pmode === PlrMode.PM_ATTACK ||
      me._pmode === PlrMode.PM_BLOCK ||
      me._pmode === PlrMode.PM_GOTHIT
    ) {
      return false;
    }

    const target = this.findNearestLivingMonster(5);
    if (target) {
      netSendCmdParam1(this.ctx, true, CmdId.CMD_ATTACKID, target.index);
      return true;
    }

    const fx = me._px + (offset_x[me._pdir] ?? 0);
    const fy = me._py + (offset_y[me._pdir] ?? 0);
    netSendCmdLoc(this.ctx, true, CmdId.CMD_SATTACKXY, fx, fy);
    return true;
  }

  /** Executes Warrior Power Cleave (4 Mana, 2.5s cooldown, AoE + Knockback via `rpg-engine`). */
  powerCleaveAction(): boolean {
    const world = this.ctx.world;
    const me = world.plr[0]!;
    if (me._pmode === PlrMode.PM_DEATH || this.powerCleaveCooldownTicks > 0) return false;

    const manaCost = 4 << 6;
    if (me._pMana < manaCost) {
      this.pushCue({ kind: 'heal', x: me._px, y: me._py, label: '마나 부족!' });
      return false;
    }

    me._pMana = i32(me._pMana - manaCost);
    me._pManaBase = i32(me._pManaBase - manaCost);
    world.drawmanaflag = true;
    this.powerCleaveCooldownTicks = 50; // 2.5s @ 20 Hz

    const target = this.findNearestLivingMonster(4);
    const dir = target ? getDirection(me._px, me._py, target.x, target.y) : me._pdir;
    clrPlrPath(world, 0);
    me.destAction = ActionId.ACTION_NONE;
    startAttack(world, 0, dir, this.ctx.hooks!);
    this.pendingPowerCleave = true;
    this.logEvent('Power Cleave initiated (-4 Mana)');
    return true;
  }

  /** Picks up nearest item or operates nearest barrel/chest within 2 tiles. */
  interactNearest(): boolean {
    const world = this.ctx.world;
    const me = world.plr[0]!;
    if (me._pmode === PlrMode.PM_DEATH) return false;

    // 1. Check nearby ground items first
    let bestItem = -1;
    let bestItemDist = 99;
    for (let i = 0; i < world.numitems; i++) {
      const ii = world.itemactive[i]!;
      const it = world.item[ii]!;
      const d = Math.max(Math.abs(it._ix - me._px), Math.abs(it._iy - me._py));
      if (d <= 2 && d < bestItemDist) {
        bestItemDist = d;
        bestItem = ii;
      }
    }
    if (bestItem !== -1) {
      const it = world.item[bestItem]!;
      netSendCmdLocParam1(this.ctx, true, CmdId.CMD_GOTOGETITEM, it._ix, it._iy, bestItem);
      return true;
    }

    // 2. Check nearby selectable objects (barrels / chests)
    let bestObj = -1;
    let bestObjDist = 99;
    for (let i = 0; i < world.nobjects; i++) {
      const oi = world.objectactive[i]!;
      const obj = world.object[oi]!;
      if (obj._oSelFlag === 0) continue;
      const d = Math.max(Math.abs(obj._ox - me._px), Math.abs(obj._oy - me._py));
      if (d <= 2 && d < bestObjDist) {
        bestObjDist = d;
        bestObj = oi;
      }
    }
    if (bestObj !== -1) {
      const obj = world.object[bestObj]!;
      netSendCmdLocParam1(this.ctx, true, CmdId.CMD_OPOBJXY, obj._ox, obj._oy, bestObj);
      return true;
    }

    return false;
  }

  /** Uses the first available healing/mana potion in belt (`SpdList`) via `useInvItem`. */
  usePotionBeltSlot(preferredSlot?: number): boolean {
    const world = this.ctx.world;
    const me = world.plr[0]!;
    if (me._pmode === PlrMode.PM_DEATH) return false;

    const trySlot = (slot: number): boolean => {
      const item = me.SpdList[slot];
      if (!item || item._itype === ItemType.ITYPE_NONE) return false;
      const prevHp = me._pHitPoints >> 6;
      const ok = useInvItem(world, 0, InvItem.INVITEM_BELT_FIRST + slot, this.ctx.hooks!);
      if (ok) {
        const gained = Math.max(0, (me._pHitPoints >> 6) - prevHp);
        this.pushCue({
          kind: 'heal',
          x: me._px,
          y: me._py,
          value: gained,
          label: gained > 0 ? `+${gained} HP 회복!` : '물약 사용!',
        });
        this.logEvent(`Used belt slot ${slot + 1} (${item._iName})`);
      }
      return ok;
    };

    if (preferredSlot !== undefined) {
      return trySlot(preferredSlot);
    }
    for (let s = 0; s < me.SpdList.length; s++) {
      if (me.SpdList[s]!._itype !== ItemType.ITYPE_NONE) {
        return trySlot(s);
      }
    }
    return false;
  }

  /** Allocates 1 stat point using `CMD_ADDSTR/MAG/DEX/VIT`. */
  allocateStat(stat: 'str' | 'mag' | 'dex' | 'vit'): boolean {
    const me = this.ctx.world.plr[0]!;
    if (me._pStatPts <= 0) return false;
    const cmdMap = {
      str: CmdId.CMD_ADDSTR,
      mag: CmdId.CMD_ADDMAG,
      dex: CmdId.CMD_ADDDEX,
      vit: CmdId.CMD_ADDVIT,
    } as const;
    netSendCmdParam1(this.ctx, true, cmdMap[stat], 1);
    return true;
  }

  /** Revives a fallen Warrior inside the Sanctum. */
  respawnWarrior(): void {
    const world = this.ctx.world;
    const me = world.plr[0]!;
    world.deathflag = false;
    me._pInvincible = false;
    clrPlrPath(world, 0);
    me.destAction = ActionId.ACTION_NONE;
    me._pHitPoints = me._pMaxHP;
    me._pHPBase = me._pMaxHPBase;
    me._pMana = me._pMaxMana;
    me._pManaBase = me._pMaxManaBase;
    placePlayer(world, 0);
    me._pmode = PlrMode.PM_STAND;
    this.logEvent('Warrior revived at Sanctum Altar');
  }

  findNearestLivingMonster(maxDist = 18): { index: number; x: number; y: number; dist: number; name: string } | null {
    const world = this.ctx.world;
    const me = world.plr[0]!;
    let best: { index: number; x: number; y: number; dist: number; name: string } | null = null;
    for (let i = 0; i < world.nummonsters; i++) {
      const mi = world.monstactive[i]!;
      const mon = world.monster[mi]!;
      if (sar32(mon._mhitpoints, 6) <= 0 || mon._mmode === MonMode.MM_DEATH) continue;
      const dist = Math.max(Math.abs(mon._mx - me._px), Math.abs(mon._my - me._py));
      if (dist <= maxDist && (!best || dist < best.dist)) {
        best = { index: mi, x: mon._mx, y: mon._my, dist, name: mon.mName };
      }
    }
    return best;
  }

  getLivingMonsterCount(): number {
    const world = this.ctx.world;
    let alive = 0;
    for (let i = 0; i < world.nummonsters; i++) {
      const mi = world.monstactive[i]!;
      const mon = world.monster[mi]!;
      if (sar32(mon._mhitpoints, 6) > 0 && mon._mmode !== MonMode.MM_DEATH) {
        alive++;
      }
    }
    return alive;
  }

  getNearbyInteractLabel(): string | null {
    const world = this.ctx.world;
    const me = world.plr[0]!;
    for (let i = 0; i < world.numitems; i++) {
      const it = world.item[world.itemactive[i]!]!;
      if (Math.max(Math.abs(it._ix - me._px), Math.abs(it._iy - me._py)) <= 2) {
        return `${it._iIdentified ? it._iIName : it._iName} 줍기`;
      }
    }
    for (let i = 0; i < world.nobjects; i++) {
      const obj = world.object[world.objectactive[i]!]!;
      if (obj._oSelFlag !== 0 && Math.max(Math.abs(obj._ox - me._px), Math.abs(obj._oy - me._py)) <= 2) {
        return obj._oBreak === 1 ? '통 부수기' : '상자 열기';
      }
    }
    return null;
  }

  getWarriorDetails() {
    const me = this.ctx.world.plr[0]!;
    const leftHand = me.InvBody[InvBodyLoc.INVLOC_HAND_LEFT];
    const rightHand = me.InvBody[InvBodyLoc.INVLOC_HAND_RIGHT];
    return {
      name: me._pName,
      level: me._pLevel,
      exp: me._pExperience,
      nextExp: me._pNextExper,
      str: me._pStrength,
      mag: me._pMagic,
      dex: me._pDexterity,
      vit: me._pVitality,
      statPts: me._pStatPts,
      gold: me._pGold,
      ac: me._pIAC + me._pIBonusAC + Math.floor(me._pDexterity / 5),
      minDmg: me._pIMinDam + me._pDamageMod,
      maxDmg: me._pIMaxDam + me._pDamageMod,
      weaponName: leftHand && leftHand._itype !== ItemType.ITYPE_NONE ? leftHand._iName : '맨손',
      shieldName: rightHand && rightHand._itype !== ItemType.ITYPE_NONE ? rightHand._iName : '없음',
      beltPotions: me.SpdList.filter((it) => it._itype !== ItemType.ITYPE_NONE).length,
      px: me._px,
      py: me._py,
      pxoff: me._pxoff,
      pyoff: me._pyoff,
      dir: me._pdir,
      mode: me._pmode,
      animFrame: me._pAnimFrame,
      animLen: me._pAnimLen,
      hp: Math.max(0, me._pHitPoints >> 6),
      maxHp: Math.max(1, me._pMaxHP >> 6),
      mana: Math.max(0, me._pMana >> 6),
      maxMana: Math.max(1, me._pMaxMana >> 6),
    };
  }

  getDiagnostics(): EngineDiagnostics {
    const world = this.ctx.world;
    const me = world.plr[0]!;
    const walkQueueLength = me.walkpath.filter((step) => step !== -1).length;
    return {
      tick: this.ctx.gnFrameCount,
      clockMs: world.clockMs,
      playerPos: {
        x: me._px,
        y: me._py,
        futX: me._pfutx,
        futY: me._pfuty,
        xoff: me._pxoff,
        yoff: me._pyoff,
      },
      playerMode: me._pmode,
      playerModeName: plrModeLabel(me._pmode),
      playerDir: me._pdir,
      animFrame: me._pAnimFrame,
      walkQueueLength,
      activeMonsters: this.getLivingMonsterCount(),
      activeObjects: world.nobjects,
      activeItems: world.numitems,
      hookStats: { ...this.hookStats },
      recentEvents: [...this.eventLog],
    };
  }
}
