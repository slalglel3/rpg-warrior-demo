/**
 * @file sanctumRenderer.ts
 * @description 2.5D Isometric Canvas Renderer matching D:\사진\rpg 직업\전사 .png's
 * storybook hand-drawn sepia-ink + cel-shaded style, combined with godot4-game-studio's
 * 3-layer depth, Y-sorted floor lane, HDR additive VFX, damped camera trauma,
 * shockwaves, and non-overlapping cut-in banners.
 */

import {
  ItemType,
  MonMode,
  MonsterId,
  ObjectId,
  PlrMode,
  type RenderSnapshot,
} from 'diablo-109b-engine';
import {
  SANCTUM_MAX_X,
  SANCTUM_MAX_Y,
  SANCTUM_MIN_X,
  SANCTUM_MIN_Y,
  SANCTUM_PILLARS,
  type CombatCue,
} from '../engine/warriorSession.js';
import { WarriorRig2D } from './warriorRig2D.js';

import glowRadialPng from '../assets/vfx/glow_radial.png';
import magicZodiacPng from '../assets/vfx/magic_zodiac.png';
import shadowOvalPng from '../assets/vfx/shadow_oval.png';
import slashArcPng from '../assets/vfx/slash_arc.png';
import smokePuffPng from '../assets/vfx/smoke_puff.png';
import sparkStreakPng from '../assets/vfx/spark_streak.png';
import warriorPortraitPng from '../assets/warrior_portrait.png';

const TILE_W = 84;
const TILE_H = 42;

interface FloatingText {
  wx: number;
  wy: number;
  text: string;
  color: string;
  scale: number;
  age: number;
  life: number;
}

interface SlashVfx {
  wx: number;
  wy: number;
  angle: number;
  heavy: boolean;
  age: number;
  life: number;
}

interface ShockwaveVfx {
  wx: number;
  wy: number;
  age: number;
  life: number;
  maxRadius: number;
  color: string;
}

interface SparkVfx {
  sx: number;
  sy: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: string;
  size: number;
}

interface CutinBanner {
  title: string;
  subtitle: string;
  accent: string;
  age: number;
  life: number;
}

function loadImg(src: string): HTMLImageElement {
  const im = new Image();
  im.src = src;
  return im;
}

export class SanctumRenderer {
  readonly rig = new WarriorRig2D();
  private vfxGlow = loadImg(glowRadialPng);
  private vfxZodiac = loadImg(magicZodiacPng);
  private vfxShadow = loadImg(shadowOvalPng);
  private vfxSlash = loadImg(slashArcPng);
  private vfxSmoke = loadImg(smokePuffPng);
  private vfxSpark = loadImg(sparkStreakPng);
  private portraitImg = loadImg(warriorPortraitPng);

  private camX = 48;
  private camY = 51;
  private trauma = 0;
  private hitstopTimer = 0;
  private hitFlash = 0;
  private blockGlow = 0;
  private powerCleaveTimer = 0;
  private lastAttackFrame = -1;
  private tapMarker: { x: number; y: number; timer: number } | null = null;

  private floatingTexts: FloatingText[] = [];
  private slashes: SlashVfx[] = [];
  private shockwaves: ShockwaveVfx[] = [];
  private sparks: SparkVfx[] = [];
  private cutinQueue: CutinBanner[] = [];
  private activeCutin: CutinBanner | null = null;

  private emberSeeds = Array.from({ length: 24 }, (_, i) => ({
    x: ((i * 197) % 100) / 100,
    y: ((i * 313) % 100) / 100,
    spd: 0.02 + ((i * 13) % 7) * 0.004,
    size: 1.5 + (i % 3),
  }));

  private pillarSet = new Set(SANCTUM_PILLARS.map((p) => `${p.x},${p.y}`));

  isInHitstop(): boolean {
    return this.hitstopTimer > 0;
  }

  markTapTile(tx: number, ty: number): void {
    this.tapMarker = { x: tx, y: ty, timer: 0.65 };
  }

  /** Converts dungeon tile coords `(tx, ty)` into screen pixels centered on canvas. */
  worldToScreen(tx: number, ty: number, viewW: number, viewH: number, shakeX = 0, shakeY = 0): { x: number; y: number } {
    const dx = tx - this.camX;
    const dy = ty - this.camY;
    const isoX = (dx - dy) * (TILE_W * 0.5);
    const isoY = (dx + dy) * (TILE_H * 0.5);
    return {
      x: viewW * 0.5 + isoX + shakeX,
      y: viewH * 0.52 + isoY + shakeY,
    };
  }

  /** Inverse isometric projection from screen pointer `(sx, sy)` back to dungeon tile `(tx, ty)`. */
  screenToWorld(sx: number, sy: number, viewW: number, viewH: number): { tx: number; ty: number } {
    const isoX = sx - viewW * 0.5;
    const isoY = sy - viewH * 0.52;
    const a = isoX / (TILE_W * 0.5); // dx - dy
    const b = isoY / (TILE_H * 0.5); // dx + dy
    const dx = (a + b) * 0.5;
    const dy = (b - a) * 0.5;
    return {
      tx: Math.round(this.camX + dx),
      ty: Math.round(this.camY + dy),
    };
  }

  ingestCombatCues(cues: readonly CombatCue[], heroName: string): void {
    for (const c of cues) {
      switch (c.kind) {
        case 'damage_monster':
          this.trauma = Math.min(1, this.trauma + 0.28);
          this.hitstopTimer = Math.max(this.hitstopTimer, 0.032);
          this.floatingTexts.push({
            wx: c.x,
            wy: c.y - 0.6,
            text: c.label ?? `-${c.value ?? 1}`,
            color: '#FFE680',
            scale: 1.0,
            age: 0,
            life: 0.78,
          });
          this.spawnWorldSparks(c.x, c.y, '#FFB84D', 8);
          break;

        case 'kill_monster':
          this.trauma = Math.min(1, this.trauma + 0.45);
          this.hitstopTimer = Math.max(this.hitstopTimer, 0.052);
          this.shockwaves.push({
            wx: c.x,
            wy: c.y,
            age: 0,
            life: 0.42,
            maxRadius: 96,
            color: '#FF7043',
          });
          this.floatingTexts.push({
            wx: c.x,
            wy: c.y - 0.85,
            text: c.label ?? '처치!',
            color: '#FFCA57',
            scale: 1.18,
            age: 0,
            life: 1.1,
          });
          this.spawnWorldSparks(c.x, c.y, '#FF6B4A', 14);
          break;

        case 'damage_player':
          this.trauma = Math.min(1, this.trauma + 0.36);
          this.hitFlash = 1.0;
          this.floatingTexts.push({
            wx: c.x,
            wy: c.y - 0.7,
            text: c.label ?? `-${c.value ?? 1}`,
            color: '#FF5A6E',
            scale: 1.08,
            age: 0,
            life: 0.85,
          });
          break;

        case 'block_player':
          this.trauma = Math.min(1, this.trauma + 0.22);
          this.blockGlow = 1.0;
          this.floatingTexts.push({
            wx: c.x,
            wy: c.y - 0.85,
            text: '방패 막기!',
            color: '#7CE8FF',
            scale: 1.12,
            age: 0,
            life: 0.9,
          });
          this.spawnWorldSparks(c.x, c.y, '#7CE8FF', 10);
          break;

        case 'power_cleave':
          this.trauma = Math.min(1, this.trauma + 0.68);
          this.hitstopTimer = Math.max(this.hitstopTimer, 0.055);
          this.powerCleaveTimer = 0.55;
          this.slashes.push({
            wx: c.x,
            wy: c.y,
            angle: 0,
            heavy: true,
            age: 0,
            life: 0.36,
          });
          this.shockwaves.push({
            wx: c.x,
            wy: c.y,
            age: 0,
            life: 0.48,
            maxRadius: 175,
            color: '#FFAE38',
          });
          this.enqueueCutin({
            title: heroName,
            subtitle: '천둥 강타!!',
            accent: '#FF8A34',
            age: 0,
            life: 1.05,
          });
          this.spawnWorldSparks(c.x, c.y, '#FFD060', 18);
          break;

        case 'level_up':
          this.trauma = Math.min(1, this.trauma + 0.4);
          this.shockwaves.push({
            wx: c.x,
            wy: c.y,
            age: 0,
            life: 0.75,
            maxRadius: 190,
            color: '#FFE074',
          });
          this.enqueueCutin({
            title: `${heroName} · LEVEL UP!`,
            subtitle: `레벨 ${c.value ?? 2} 달성! (+5 스탯)`,
            accent: '#FFCA57',
            age: 0,
            life: 1.45,
          });
          this.floatingTexts.push({
            wx: c.x,
            wy: c.y - 1.1,
            text: c.label ?? 'LEVEL UP!',
            color: '#FFE885',
            scale: 1.32,
            age: 0,
            life: 1.4,
          });
          break;

        case 'heal':
          this.floatingTexts.push({
            wx: c.x,
            wy: c.y - 0.7,
            text: c.label ?? '+HP',
            color: '#6CF0A8',
            scale: 1.06,
            age: 0,
            life: 0.9,
          });
          this.spawnWorldSparks(c.x, c.y, '#6CF0A8', 8);
          break;

        case 'loot':
        case 'object_break':
          this.floatingTexts.push({
            wx: c.x,
            wy: c.y - 0.65,
            text: c.label ?? '획득',
            color: '#F7D27A',
            scale: 0.98,
            age: 0,
            life: 0.95,
          });
          this.spawnWorldSparks(c.x, c.y, '#F7D27A', 6);
          break;

        case 'wave_spawn':
          this.floatingTexts.push({
            wx: c.x,
            wy: c.y - 1.2,
            text: c.label ?? `제 ${c.value ?? 1} 웨이브`,
            color: '#FF9E64',
            scale: 1.25,
            age: 0,
            life: 1.25,
          });
          break;
      }
    }
  }

  private enqueueCutin(banner: CutinBanner): void {
    if (!this.activeCutin) {
      this.activeCutin = banner;
    } else if (this.cutinQueue.length < 2) {
      this.cutinQueue.push(banner);
    }
  }

  private spawnWorldSparks(wx: number, wy: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const spd = 70 + Math.random() * 145;
      this.sparks.push({
        sx: wx,
        sy: wy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 35,
        age: 0,
        life: 0.35 + Math.random() * 0.25,
        color,
        size: 16 + Math.random() * 14,
      });
    }
  }

  updateEffects(dt: number, snap: RenderSnapshot, pxoff: number, pyoff: number): void {
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
    }
    this.trauma = Math.max(0, this.trauma - dt * 2.2);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3.8);
    this.blockGlow = Math.max(0, this.blockGlow - dt * 2.6);
    this.powerCleaveTimer = Math.max(0, this.powerCleaveTimer - dt);

    if (this.tapMarker) {
      this.tapMarker.timer -= dt;
      if (this.tapMarker.timer <= 0) this.tapMarker = null;
    }

    const p = snap.players[0];
    if (p) {
      const sub = this.subOffsetToTile(pxoff, pyoff);
      const targetX = p.x + sub.dx;
      const targetY = p.y + sub.dy;
      const lerp = 1 - Math.exp(-dt * 12);
      this.camX += (targetX - this.camX) * lerp;
      this.camY += (targetY - this.camY) * lerp;

      // Spawn normal broadsword slash arc on hit frame 8..9
      if (p.mode === PlrMode.PM_ATTACK && p.animFrame >= 8 && p.animFrame <= 10 && this.lastAttackFrame !== p.animFrame) {
        if (this.lastAttackFrame < 8) {
          const dirAngle = (p.dir * Math.PI) / 4;
          this.slashes.push({
            wx: p.x + sub.dx,
            wy: p.y + sub.dy,
            angle: dirAngle,
            heavy: this.powerCleaveTimer > 0,
            age: 0,
            life: 0.26,
          });
        }
        this.lastAttackFrame = p.animFrame;
      } else if (p.mode !== PlrMode.PM_ATTACK) {
        this.lastAttackFrame = -1;
      }
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i]!;
      ft.age += dt;
      if (ft.age >= ft.life) this.floatingTexts.splice(i, 1);
    }
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i]!;
      s.age += dt;
      if (s.age >= s.life) this.slashes.splice(i, 1);
    }
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i]!;
      sw.age += dt;
      if (sw.age >= sw.life) this.shockwaves.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i]!;
      sp.age += dt;
      if (sp.age >= sp.life) this.sparks.splice(i, 1);
    }

    if (this.activeCutin) {
      this.activeCutin.age += dt;
      if (this.activeCutin.age >= this.activeCutin.life) {
        this.activeCutin = this.cutinQueue.shift() ?? null;
      }
    }
  }

  private subOffsetToTile(pxoff: number, pyoff: number): { dx: number; dy: number } {
    // Devilution tile size is 64x32 in screen coords; convert screen pixel offset into tile coords
    const a = pxoff / 32;
    const b = pyoff / 16;
    return {
      dx: (a + b) * 0.5,
      dy: (b - a) * 0.5,
    };
  }

  renderScene(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    snap: RenderSnapshot,
    pxoff: number,
    pyoff: number,
    timeSec: number,
    isWallTile: (x: number, y: number) => boolean,
    isItemGold: (idx: number) => boolean,
  ): void {
    const shakePow = this.trauma * this.trauma;
    const shakeX = (Math.sin(timeSec * 57) * 0.7 + Math.cos(timeSec * 83) * 0.3) * 14 * shakePow;
    const shakeY = (Math.cos(timeSec * 63) * 0.7 + Math.sin(timeSec * 71) * 0.3) * 10 * shakePow;

    // --- LAYER 0: FAR TWILIGHT SANCTUM BACKDROP ---
    const bgGrad = ctx.createLinearGradient(0, 0, 0, viewH);
    bgGrad.addColorStop(0, '#1B1626');
    bgGrad.addColorStop(0.55, '#272034');
    bgGrad.addColorStop(1, '#16131E');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, viewW, viewH);

    // Subtle floating warm embers in far background
    ctx.save();
    for (const m of this.emberSeeds) {
      const my = ((m.y - timeSec * m.spd) % 1 + 1) % 1;
      const mx = m.x + Math.sin(timeSec * 0.9 + m.y * 10) * 0.02;
      ctx.fillStyle = 'rgba(255, 206, 128, 0.16)';
      ctx.beginPath();
      ctx.arc(mx * viewW, my * viewH, m.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // --- LAYER 1: PAINTED STORYBOOK ISOMETRIC SANCTUM FLOOR ---
    for (let x = SANCTUM_MIN_X - 1; x <= SANCTUM_MAX_X + 1; x++) {
      for (let y = SANCTUM_MIN_Y - 1; y <= SANCTUM_MAX_Y + 1; y++) {
        const isBorderWall =
          x < SANCTUM_MIN_X || x > SANCTUM_MAX_X || y < SANCTUM_MIN_Y || y > SANCTUM_MAX_Y;
        const pos = this.worldToScreen(x, y, viewW, viewH, shakeX, shakeY);
        if (pos.x < -TILE_W || pos.x > viewW + TILE_W || pos.y < -TILE_H * 3 || pos.y > viewH + TILE_H * 2) {
          continue;
        }
        if (isBorderWall) continue;

        const checker = (x + y) % 2 === 0;
        const isCenterRune = x >= 47 && x <= 50 && y >= 49 && y <= 52;
        const fill = isCenterRune
          ? checker
            ? '#645463'
            : '#5B4C5A'
          : checker
            ? '#524752'
            : '#493F4A';
        this.drawIsoFloorDiamond(ctx, pos.x, pos.y, fill, '#2B1F1C');
      }
    }

    // Center Sanctum Golden Zodiac Rune (2.5D squashed ground projection)
    const centerPos = this.worldToScreen(48.5, 50.5, viewW, viewH, shakeX, shakeY);
    if (this.vfxZodiac.complete) {
      ctx.save();
      ctx.translate(centerPos.x, centerPos.y);
      ctx.scale(1.0, 0.5);
      ctx.rotate(timeSec * 0.18);
      ctx.globalAlpha = 0.24;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.vfxZodiac, -135, -135, 270, 270);
      ctx.restore();
    }

    // Tap destination reticle
    if (this.tapMarker) {
      const mp = this.worldToScreen(this.tapMarker.x, this.tapMarker.y, viewW, viewH, shakeX, shakeY);
      const pulse = 1 + (1 - this.tapMarker.timer / 0.65) * 0.22;
      ctx.save();
      ctx.translate(mp.x, mp.y);
      ctx.scale(pulse, pulse * 0.5);
      ctx.strokeStyle = `rgba(255, 224, 130, ${this.tapMarker.timer})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // --- LAYER 2: Y-SORTED 2.5D WALLS, PILLARS, PROPS, ITEMS, MONSTERS, & WARRIOR ---
    type DrawItem = { depth: number; draw: () => void };
    const drawList: DrawItem[] = [];

    // Perimeter 2.5D walls & 4 Sanctum pillars
    for (let x = SANCTUM_MIN_X - 1; x <= SANCTUM_MAX_X + 1; x++) {
      for (let y = SANCTUM_MIN_Y - 1; y <= SANCTUM_MAX_Y + 1; y++) {
        const isBorder =
          x < SANCTUM_MIN_X || x > SANCTUM_MAX_X || y < SANCTUM_MIN_Y || y > SANCTUM_MAX_Y;
        const isPillar = this.pillarSet.has(`${x},${y}`) || (!isBorder && isWallTile(x, y));
        if (!isBorder && !isPillar) continue;
        // Skip far south-east front border blocks above camera to keep floor clear, draw subtle low trim instead
        const pos = this.worldToScreen(x, y, viewW, viewH, shakeX, shakeY);
        if (pos.x < -TILE_W || pos.x > viewW + TILE_W || pos.y < -120 || pos.y > viewH + 100) continue;
        const isSouthRim = x > SANCTUM_MAX_X || y > SANCTUM_MAX_Y;
        const height = isPillar ? 68 : isSouthRim ? 18 : 54;
        drawList.push({
          depth: x + y,
          draw: () => this.drawIsoBlock(ctx, pos.x, pos.y, height, isPillar, timeSec, x, y),
        });
      }
    }

    // Interactive Objects (Barrels / Chests)
    for (const obj of snap.objects) {
      const pos = this.worldToScreen(obj.x, obj.y, viewW, viewH, shakeX, shakeY);
      drawList.push({
        depth: obj.x + obj.y + 0.05,
        draw: () => this.drawSanctumObject(ctx, pos.x, pos.y, obj.otype, obj.selFlag > 0),
      });
    }

    // Ground Items (Gold / Potions / Gear)
    for (const it of snap.items) {
      const pos = this.worldToScreen(it.x, it.y, viewW, viewH, shakeX, shakeY);
      drawList.push({
        depth: it.x + it.y + 0.08,
        draw: () => this.drawGroundItem(ctx, pos.x, pos.y, isItemGold(it.index), it.name, timeSec),
      });
    }

    // Monsters (Hand-drawn chibi cel-shaded monsters matching Warrior art style!)
    for (const m of snap.monsters) {
      if (m.hp <= 0 || m.mode === MonMode.MM_DEATH) {
        const pos = this.worldToScreen(m.x, m.y, viewW, viewH, shakeX, shakeY);
        drawList.push({
          depth: m.x + m.y - 0.1,
          draw: () => this.drawMonsterCorpse(ctx, pos.x, pos.y),
        });
        continue;
      }
      const pos = this.worldToScreen(m.x, m.y, viewW, viewH, shakeX, shakeY);
      drawList.push({
        depth: m.x + m.y + 0.15,
        draw: () => this.drawChibiMonster(ctx, pos.x, pos.y, m, timeSec),
      });
    }

    // Warrior (7-part articulated RiggedActor2D!)
    const me = snap.players[0];
    if (me) {
      const sub = this.subOffsetToTile(pxoff, pyoff);
      const wx = me.x + sub.dx;
      const wy = me.y + sub.dy;
      const pos = this.worldToScreen(wx, wy, viewW, viewH, shakeX, shakeY);
      drawList.push({
        depth: wx + wy + 0.2,
        draw: () => {
          // Contact shadow
          if (this.vfxShadow.complete) {
            ctx.save();
            ctx.globalAlpha = 0.56;
            ctx.drawImage(this.vfxShadow, pos.x - 42, pos.y - 12, 84, 26);
            ctx.restore();
          } else {
            ctx.fillStyle = 'rgba(20, 12, 18, 0.45)';
            ctx.beginPath();
            ctx.ellipse(pos.x, pos.y + 2, 34, 11, 0, 0, Math.PI * 2);
            ctx.fill();
          }

          // Block ward aura
          if (this.blockGlow > 0.05 && this.vfxZodiac.complete) {
            ctx.save();
            ctx.translate(pos.x, pos.y + 2);
            ctx.scale(1, 0.45);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = this.blockGlow * 0.7;
            ctx.drawImage(this.vfxZodiac, -68, -68, 136, 136);
            ctx.restore();
          }

          this.rig.render(ctx, pos.x, pos.y + 6, 0.24, {
            mode: me.mode,
            dir: me.dir,
            animFrame: me.animFrame,
            animLen: 16,
            timeSec,
            hitFlash: this.hitFlash,
            blockGlow: this.blockGlow,
            powerCleaveTimer: this.powerCleaveTimer,
          });
        },
      });
    }

    drawList.sort((a, b) => a.depth - b.depth);
    for (const item of drawList) {
      item.draw();
    }

    // --- LAYER 3: HDR ADDITIVE SLASH ARCS, SHOCKWAVES, SPARKS & FLOATING COMBAT TEXT ---
    this.renderLayer3Vfx(ctx, viewW, viewH, shakeX, shakeY);

    // Non-overlapping Skill / Level-up Cut-in Banner
    if (this.activeCutin) {
      this.renderCutinBanner(ctx, viewW, this.activeCutin);
    }
  }

  private drawIsoFloorDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, fill: string, stroke: string): void {
    const hw = TILE_W * 0.5;
    const hh = TILE_H * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  private drawIsoBlock(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    height: number,
    isPillar: boolean,
    timeSec: number,
    gx: number,
    gy: number,
  ): void {
    const hw = TILE_W * 0.5;
    const hh = TILE_H * 0.5;

    // Contact shadow for pillars
    if (isPillar) {
      ctx.fillStyle = 'rgba(18, 12, 20, 0.4)';
      ctx.beginPath();
      ctx.ellipse(cx + 6, cy + 4, 34, 14, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Left wall face
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx, cy + hh - height);
    ctx.lineTo(cx - hw, cy - height);
    ctx.closePath();
    ctx.fillStyle = isPillar ? '#5B505E' : '#453B48';
    ctx.fill();
    ctx.strokeStyle = '#291D1B';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Right wall face
    ctx.beginPath();
    ctx.moveTo(cx, cy + hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx + hw, cy - height);
    ctx.lineTo(cx, cy + hh - height);
    ctx.closePath();
    ctx.fillStyle = isPillar ? '#463C49' : '#352C38';
    ctx.fill();
    ctx.stroke();

    // Top bevel cap
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh - height);
    ctx.lineTo(cx + hw, cy - height);
    ctx.lineTo(cx, cy + hh - height);
    ctx.lineTo(cx - hw, cy - height);
    ctx.closePath();
    ctx.fillStyle = isPillar ? '#7B6D7D' : '#615364';
    ctx.fill();
    ctx.stroke();

    // Warm torchlight brazier glow on pillars
    if (isPillar) {
      const flicker = 0.85 + 0.15 * Math.sin(timeSec * 8.5 + gx * 3 + gy * 5);
      if (this.vfxGlow.complete) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.42 * flicker;
        ctx.drawImage(this.vfxGlow, cx - 54, cy - height - 54, 108, 108);
        ctx.restore();
      }
      ctx.fillStyle = '#FFBF4D';
      ctx.strokeStyle = '#3B2318';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy - height - 6, 7 * flicker, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawSanctumObject(ctx: CanvasRenderingContext2D, cx: number, cy: number, otype: number, intact: boolean): void {
    const isBarrel = otype === ObjectId.OBJ_BARREL || otype === ObjectId.OBJ_BARRELEX;
    ctx.save();
    ctx.translate(cx, cy);

    ctx.fillStyle = 'rgba(18, 12, 18, 0.4)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 22, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!intact) {
      // Broken splinters or opened chest
      ctx.fillStyle = isBarrel ? '#6E4A2E' : '#8B6538';
      ctx.strokeStyle = '#2B1B14';
      ctx.lineWidth = 2;
      ctx.fillRect(-16, -8, 32, 12);
      ctx.strokeRect(-16, -8, 32, 12);
      ctx.restore();
      return;
    }

    if (isBarrel) {
      // Hand-drawn wooden barrel with iron hoops & sepia outline
      ctx.fillStyle = '#9C643B';
      ctx.strokeStyle = '#2E1C14';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.roundRect(-15, -34, 30, 36, 9);
      ctx.fill();
      ctx.stroke();
      // Iron bands
      ctx.fillStyle = '#7E8899';
      ctx.fillRect(-15, -26, 30, 5);
      ctx.strokeRect(-15, -26, 30, 5);
      ctx.fillRect(-15, -11, 30, 5);
      ctx.strokeRect(-15, -11, 30, 5);
      // Top lid
      ctx.fillStyle = '#B87C4F';
      ctx.beginPath();
      ctx.ellipse(0, -33, 14, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // Golden-trimmed Sanctuary Chest
      ctx.fillStyle = '#7C4B2B';
      ctx.strokeStyle = '#2B1B14';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(-20, -28, 40, 28, 6);
      ctx.fill();
      ctx.stroke();
      // Gold trim & clasp
      ctx.fillStyle = '#EAB854';
      ctx.fillRect(-20, -18, 40, 5);
      ctx.strokeRect(-20, -18, 40, 5);
      ctx.fillRect(-5, -20, 10, 11);
      ctx.strokeRect(-5, -20, 10, 11);
    }
    ctx.restore();
  }

  private drawGroundItem(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    isGold: boolean,
    name: string,
    timeSec: number,
  ): void {
    const bob = Math.sin(timeSec * 4.5 + cx) * 3;
    ctx.save();
    ctx.translate(cx, cy + bob);

    if (this.vfxGlow.complete) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45;
      ctx.drawImage(this.vfxGlow, -24, -28, 48, 48);
      ctx.restore();
    }

    ctx.strokeStyle = '#2E1C14';
    ctx.lineWidth = 2.2;
    if (isGold) {
      ctx.fillStyle = '#F7C948';
      ctx.beginPath();
      ctx.arc(-5, -6, 7, 0, Math.PI * 2);
      ctx.arc(5, -4, 7, 0, Math.PI * 2);
      ctx.arc(0, -10, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // Ruby potion / equipment gem
      ctx.fillStyle = '#E04252';
      ctx.beginPath();
      ctx.arc(0, -8, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#D8B37C';
      ctx.fillRect(-4, -22, 8, 6);
      ctx.strokeRect(-4, -22, 8, 6);
    }

    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#191216';
    ctx.lineWidth = 3;
    ctx.strokeText(name || '전리품', 0, -26);
    ctx.fillStyle = isGold ? '#FFE27A' : '#A6E3FF';
    ctx.fillText(name || '전리품', 0, -26);
    ctx.restore();
  }

  private drawMonsterCorpse(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = '#4B3E46';
    ctx.strokeStyle = '#22171B';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 2, 22, 9, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawChibiMonster(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    m: RenderSnapshot['monsters'][number],
    timeSec: number,
  ): void {
    const isWalk = m.mode === MonMode.MM_WALK || m.mode === MonMode.MM_WALK2 || m.mode === MonMode.MM_WALK3;
    const isAtk = m.mode === MonMode.MM_ATTACK || m.mode === MonMode.MM_SATTACK;
    const isHit = m.mode === MonMode.MM_GOTHIT;
    const bob = isWalk ? Math.abs(Math.sin(timeSec * 12 + m.index)) * -8 : Math.sin(timeSec * 4 + m.index) * 2.5;
    const lean = isAtk ? -0.18 : isHit ? 0.2 : 0;

    const isFallen = m.mtype >= MonsterId.MT_RFALLSP && m.mtype <= MonsterId.MT_BFALLSD;
    const isSkel = m.mtype >= MonsterId.MT_WSKELAX && m.mtype <= MonsterId.MT_XSKELSD;

    ctx.save();
    ctx.translate(cx, cy);

    // Contact shadow
    ctx.fillStyle = 'rgba(18, 10, 16, 0.45)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 26, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(0, bob);
    ctx.rotate(lean);

    ctx.strokeStyle = '#2D1B18';
    ctx.lineWidth = 2.6;

    // Stylized chibi body matching 전사.png proportions & cel-shading!
    const bodyColor = isHit
      ? '#FFF0C2'
      : isFallen
        ? '#D1453B'
        : isSkel
          ? '#D8D4CC'
          : '#5C7C72';
    const headColor = isHit
      ? '#FFF6DB'
      : isFallen
        ? '#E35B4B'
        : isSkel
          ? '#ECE8DE'
          : '#779C8E';

    // Torso
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.roundRect(-16, -42, 32, 32, 10);
    ctx.fill();
    ctx.stroke();

    // Armor belt / tunic band
    ctx.fillStyle = isSkel ? '#7B8292' : '#5E4232';
    ctx.fillRect(-16, -24, 32, 7);
    ctx.strokeRect(-16, -24, 32, 7);

    // Chibi Oversized Head
    ctx.fillStyle = headColor;
    ctx.beginPath();
    ctx.arc(0, -58, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Horns for Fallen One or Helm for Skeleton Guard
    if (isFallen) {
      ctx.fillStyle = '#F2C166';
      ctx.beginPath();
      ctx.moveTo(-14, -71);
      ctx.lineTo(-21, -86);
      ctx.lineTo(-7, -76);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(14, -71);
      ctx.lineTo(21, -86);
      ctx.lineTo(7, -76);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (isSkel) {
      ctx.fillStyle = '#8993A6';
      ctx.beginPath();
      ctx.arc(0, -63, 21, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Expressive eyes
    ctx.fillStyle = isFallen ? '#FFE164' : isSkel ? '#FF5E4A' : '#F4DF9B';
    ctx.beginPath();
    ctx.arc(-7, -57, 3.6, 0, Math.PI * 2);
    ctx.arc(7, -57, 3.6, 0, Math.PI * 2);
    ctx.fill();

    // Weapon in hand (spear / rusted blade)
    ctx.fillStyle = '#B8C0CE';
    ctx.beginPath();
    ctx.roundRect(15, -48, 7, 28, 3);
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // Crisp floating Monster Name + HP bar above head
    const hpRatio = Math.max(0, Math.min(1, m.hp / Math.max(1, m.maxHp)));
    const barW = 54;
    const barY = cy - 94 + bob;
    ctx.save();
    ctx.fillStyle = 'rgba(20, 14, 22, 0.85)';
    ctx.fillRect(cx - barW / 2 - 1, barY - 1, barW + 2, 8);
    ctx.fillStyle = '#E0434B';
    ctx.fillRect(cx - barW / 2, barY, barW * hpRatio, 6);
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#181018';
    ctx.lineWidth = 3;
    ctx.strokeText(m.name, cx, barY - 4);
    ctx.fillStyle = '#FBEED7';
    ctx.fillText(m.name, cx, barY - 4);
    ctx.restore();
  }

  private renderLayer3Vfx(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    shakeX: number,
    shakeY: number,
  ): void {
    // 1. Slash Arcs (HDR additive)
    for (const s of this.slashes) {
      const p = s.age / s.life;
      const pos = this.worldToScreen(s.wx, s.wy, viewW, viewH, shakeX, shakeY);
      if (!this.vfxSlash.complete) continue;
      ctx.save();
      ctx.translate(pos.x, pos.y - 42);
      ctx.rotate(s.angle - 0.8 + p * 2.1);
      const sc = s.heavy ? 1.55 : 0.95;
      ctx.scale(sc, sc * 0.72);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.max(0, (1 - p) * (s.heavy ? 0.95 : 0.78));
      ctx.drawImage(this.vfxSlash, -110, -110, 220, 220);
      ctx.restore();
    }

    // 2. Shockwaves
    for (const sw of this.shockwaves) {
      const p = sw.age / sw.life;
      const pos = this.worldToScreen(sw.wx, sw.wy, viewW, viewH, shakeX, shakeY);
      const r = 20 + (sw.maxRadius - 20) * (1 - Math.pow(1 - p, 2));
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.scale(1, 0.5);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.lineWidth = Math.max(2, 12 * (1 - p));
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Additive Sparks
    for (const sp of this.sparks) {
      const p = sp.age / sp.life;
      const base = this.worldToScreen(sp.sx, sp.sy, viewW, viewH, shakeX, shakeY);
      const px = base.x + sp.vx * sp.age;
      const py = base.y - 34 + sp.vy * sp.age + 120 * sp.age * sp.age;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.max(0, 1 - p);
      if (this.vfxSpark.complete) {
        ctx.translate(px, py);
        ctx.rotate(Math.atan2(sp.vy + 240 * sp.age, sp.vx));
        ctx.drawImage(this.vfxSpark, -sp.size, -sp.size * 0.35, sp.size * 2, sp.size * 0.7);
      } else {
        ctx.fillStyle = sp.color;
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 4. Floating Comic-Outline Combat Numbers
    for (const ft of this.floatingTexts) {
      const p = ft.age / ft.life;
      const pos = this.worldToScreen(ft.wx, ft.wy, viewW, viewH, shakeX, shakeY);
      const yOff = -48 - p * 44;
      const pop = p < 0.16 ? 0.7 + (p / 0.16) * 0.45 : 1.05;
      ctx.save();
      ctx.translate(pos.x, pos.y + yOff);
      ctx.scale(ft.scale * pop, ft.scale * pop);
      ctx.globalAlpha = p > 0.7 ? Math.max(0, (1 - p) / 0.3) : 1;
      ctx.font = '900 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#241412';
      ctx.lineWidth = 4.5;
      ctx.strokeText(ft.text, 0, 0);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, 0, 0);
      ctx.restore();
    }

    void this.vfxSmoke;
  }

  private renderCutinBanner(ctx: CanvasRenderingContext2D, viewW: number, banner: CutinBanner): void {
    const p = banner.age / banner.life;
    const slide = p < 0.16 ? p / 0.16 : 1;
    const alpha = p > 0.78 ? Math.max(0, (1 - p) / 0.22) : 1;
    const easeOut = 1 - Math.pow(1 - slide, 3);
    const w = 310;
    const h = 76;
    const targetX = viewW - w - 18;
    const x = targetX + (1 - easeOut) * 180;
    const y = 76;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(26, 20, 32, 0.9)';
    ctx.strokeStyle = banner.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 12);
    ctx.fill();
    ctx.stroke();

    if (this.portraitImg.complete) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x + 4, y + 4, 68, 68, 8);
      ctx.clip();
      ctx.drawImage(this.portraitImg, x + 4, y + 4, 68, 68);
      ctx.restore();
    }

    ctx.fillStyle = '#FFE3A3';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText(banner.title, x + 82, y + 28);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 20px system-ui, sans-serif';
    ctx.fillText(banner.subtitle, x + 82, y + 56);
    ctx.restore();
  }
}
