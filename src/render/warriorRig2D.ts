/**
 * @file warriorRig2D.ts
 * @description Real-time 2.5D 7-part hierarchical skeletal renderer for the Warrior
 * extracted from D:\사진\rpg 직업\전사 .png via concept-asset-studio and verified in
 * Godot 4.7 RiggedActor2D (`warrior_motion_studio.gd`).
 */

import { Direction, PlrMode } from 'diablo-109b-engine';
import warriorAtlasPng from '../assets/warrior_atlas.png';
import warriorAtlasJson from '../assets/warrior_atlas.json';
import rigManifestJson from '../assets/rig_manifest.json';

interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  canvas: {
    x: number;
    y: number;
    w: number;
    h: number;
    orig_w: number;
    orig_h: number;
  };
}

export interface WarriorPoseInput {
  mode: number;
  dir: number;
  animFrame: number;
  animLen: number;
  timeSec: number;
  hitFlash: number;
  blockGlow: number;
  powerCleaveTimer: number;
}

const DEG = Math.PI / 180;

function smoothstep(t: number, a: number, b: number): number {
  const x = Math.max(0, Math.min(1, (t - a) / Math.max(0.001, b - a)));
  return x * x * (3 - 2 * x);
}

export class WarriorRig2D {
  readonly atlasImage = new Image();
  loaded = false;
  private frames: Record<string, AtlasFrame>;
  private scaleWeb: number;
  private pivots: Record<string, [number, number]>;
  private scratchCanvas: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;

  constructor() {
    this.frames = (warriorAtlasJson as unknown as { frames: Record<string, AtlasFrame> }).frames;
    this.scaleWeb = (rigManifestJson as unknown as { web_scale: number }).web_scale ?? 0.55;
    this.pivots = (rigManifestJson as unknown as { pivots: Record<string, [number, number]> }).pivots;

    this.scratchCanvas = document.createElement('canvas');
    this.scratchCanvas.width = 240;
    this.scratchCanvas.height = 240;
    this.scratchCtx = this.scratchCanvas.getContext('2d')!;

    this.atlasImage.onload = () => {
      this.loaded = true;
    };
    this.atlasImage.src = warriorAtlasPng;
    if (this.atlasImage.complete && this.atlasImage.naturalWidth > 0) {
      this.loaded = true;
    }
  }

  private pv(name: string): { x: number; y: number } {
    const p = this.pivots[name] ?? [685, 995];
    return { x: p[0] * this.scaleWeb, y: p[1] * this.scaleWeb };
  }

  private drawAtlasPart(ctx: CanvasRenderingContext2D, key: string): void {
    const f = this.frames[key];
    if (!f) return;
    ctx.drawImage(
      this.atlasImage,
      f.x,
      f.y,
      f.w,
      f.h,
      f.canvas.x,
      f.canvas.y,
      f.canvas.w,
      f.canvas.h,
    );
  }

  private drawPartWithPivot(
    ctx: CanvasRenderingContext2D,
    key: string,
    px: number,
    py: number,
    rotDeg: number,
    dx = 0,
    dy = 0,
    scaleX = 1,
    scaleY = 1,
  ): void {
    ctx.save();
    ctx.translate(px + dx, py + dy);
    if (rotDeg !== 0) ctx.rotate(rotDeg * DEG);
    if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);
    ctx.translate(-px, -py);
    this.drawAtlasPart(ctx, key);
    ctx.restore();
  }

  /** Returns whether the warrior sprite should flip horizontally for isometric facing direction. */
  isFacingLeft(dir: number): boolean {
    return dir === Direction.DIR_W || dir === Direction.DIR_SW || dir === Direction.DIR_NW || dir === Direction.DIR_N;
  }

  render(ctx: CanvasRenderingContext2D, footX: number, footY: number, scale: number, pose: WarriorPoseInput): void {
    if (!this.loaded) return;

    const facingLeft = this.isFacingLeft(pose.dir);
    const t = pose.timeSec;
    const isWalk =
      pose.mode === PlrMode.PM_WALK || pose.mode === PlrMode.PM_WALK2 || pose.mode === PlrMode.PM_WALK3;
    const isAttack = pose.mode === PlrMode.PM_ATTACK;
    const isBlock = pose.mode === PlrMode.PM_BLOCK;
    const isHit = pose.mode === PlrMode.PM_GOTHIT;
    const isDead = pose.mode === PlrMode.PM_DEATH;

    // Compute clean hierarchical bone kinematics (verified against Godot 4.7 contact_sheet.jpg)
    const breath = Math.sin(t * 4.2);
    const walkPhase = t * 13.5;
    const walkSin = Math.sin(walkPhase);
    const walkLiftL = Math.max(0, Math.cos(walkPhase));
    const walkLiftR = Math.max(0, -Math.cos(walkPhase));

    // Attack normalized progress [0..1] across 16 engine frames (impact on frame 9)
    const atkP = isAttack ? Math.max(0, Math.min(1, (pose.animFrame - 1) / Math.max(1, pose.animLen - 1))) : 0;
    const windup = isAttack ? smoothstep(atkP, 0.0, 0.34) * (1 - smoothstep(atkP, 0.34, 0.48)) : 0;
    const cleave = isAttack ? smoothstep(atkP, 0.34, 0.62) * (1 - smoothstep(atkP, 0.72, 1.0)) : 0;
    const isCleaveHeavy = pose.powerCleaveTimer > 0 ? 1.25 : 1.0;

    let pelvisDx = 0;
    let pelvisDy = breath * 2.2;
    let spineDeg = breath * 1.4;
    let headDeg = -breath * 1.1;
    let legRDeg = 0;
    let legLDeg = 0;
    let legRDy = 0;
    let legLDy = 0;
    let swordArmDeg = breath * 2.0;
    let shieldArmDeg = -breath * 1.5;
    let capeDeg = Math.sin(t * 4.8) * 5.0;
    let wholeDeathDeg = 0;
    let wholeDeathDy = 0;

    if (isWalk) {
      pelvisDy = Math.abs(walkSin) * -6.5;
      pelvisDx = walkSin * 4.0;
      spineDeg = 6.0 + walkSin * 3.5;
      headDeg = -3.0 - walkSin * 2.0;
      legRDeg = -15.0 * walkSin;
      legLDeg = 15.0 * walkSin;
      legRDy = -8.5 * walkLiftR;
      legLDy = -8.5 * walkLiftL;
      swordArmDeg = 16.0 * walkSin;
      shieldArmDeg = -13.0 * walkSin;
      capeDeg = Math.sin(t * 11.0) * 11.0 - 12.0;
    }

    if (isAttack) {
      pelvisDx = (-12 * windup + 22 * cleave) * isCleaveHeavy;
      pelvisDy = (11 * windup + 7 * cleave) * isCleaveHeavy;
      spineDeg = (-12 * windup + 18 * cleave) * isCleaveHeavy;
      headDeg = (7 * windup - 10 * cleave) * isCleaveHeavy;
      legRDeg = -10 * cleave;
      legLDeg = 12 * cleave;
      // Verified sign convention: +deg swings sword UP clockwise over shoulder; -deg sweeps DOWN-RIGHT cleave!
      swordArmDeg = (88 * windup - 68 * cleave) * isCleaveHeavy;
      shieldArmDeg = (18 * windup - 24 * cleave) * isCleaveHeavy;
      capeDeg = Math.sin(t * 16) * 8 - 22 * cleave;
    }

    if (isBlock) {
      pelvisDy = 10;
      pelvisDx = -6;
      spineDeg = -7;
      shieldArmDeg = -22; // snaps shield forward/up cleanly
      swordArmDeg = 18;
      capeDeg = 12;
    }

    if (isHit) {
      pelvisDx = -14;
      pelvisDy = 6;
      spineDeg = -14;
      headDeg = -10;
      swordArmDeg = -18;
      shieldArmDeg = 14;
      capeDeg = 22;
    }

    if (isDead) {
      wholeDeathDeg = -84;
      wholeDeathDy = 34;
    }

    // Pivot references in web-canvas coords (632x588)
    const rootFeet = this.pv('root_feet');
    const pelvis = this.pv('pelvis');
    const chest = this.pv('chest');
    const neck = this.pv('neck');
    const shoulderR = this.pv('shoulder_r');
    const shoulderL = this.pv('shoulder_l');
    const hipR = this.pv('hip_r');
    const hipL = this.pv('hip_l');
    const cape1 = this.pv('cape_1');

    // Render onto scratch canvas if hit-flash is active so tint applies strictly to Warrior silhouette
    const useFlashBuffer = pose.hitFlash > 0.04;
    let targetCtx = ctx;

    if (useFlashBuffer) {
      const s = this.scratchCanvas;
      this.scratchCtx.clearRect(0, 0, s.width, s.height);
      targetCtx = this.scratchCtx;
      targetCtx.save();
      targetCtx.translate(s.width * 0.5, s.height * 0.85);
    } else {
      targetCtx.save();
      targetCtx.translate(footX, footY);
    }

    if (facingLeft) {
      targetCtx.scale(-scale, scale);
    } else {
      targetCtx.scale(scale, scale);
    }

    if (wholeDeathDeg !== 0) {
      targetCtx.translate(0, wholeDeathDy);
      targetCtx.rotate(wholeDeathDeg * DEG);
    }

    // Center so root_feet sits right at (0, 0)
    targetCtx.translate(-rootFeet.x, -rootFeet.y);

    // 1. Cape (parented to Chest/Upper Torso)
    targetCtx.save();
    targetCtx.translate(pelvis.x + pelvisDx, pelvis.y + pelvisDy);
    targetCtx.rotate(spineDeg * 0.65 * DEG);
    targetCtx.translate(-pelvis.x, -pelvis.y);
    this.drawPartWithPivot(targetCtx, 'cape', cape1.x, cape1.y, capeDeg);
    targetCtx.restore();

    // 2. Legs (LegL back, LegR front — attached to Pelvis)
    this.drawPartWithPivot(targetCtx, 'leg_l', hipL.x, hipL.y, legLDeg, pelvisDx * 0.4, pelvisDy * 0.35 + legLDy);
    this.drawPartWithPivot(targetCtx, 'leg_r', hipR.x, hipR.y, legRDeg, pelvisDx * 0.4, pelvisDy * 0.35 + legRDy);

    // 3. Upper Body Hierarchy (Pelvis -> Chest -> RightArmSword, Head, LeftArmShield)
    targetCtx.save();
    targetCtx.translate(pelvis.x + pelvisDx, pelvis.y + pelvisDy);
    targetCtx.rotate(spineDeg * DEG);
    targetCtx.translate(-pelvis.x, -pelvis.y);

    // Torso armor
    this.drawAtlasPart(targetCtx, 'body');

    // Right Arm + Broadsword (pivoted at ShoulderR)
    this.drawPartWithPivot(targetCtx, 'right_arm_sword', shoulderR.x, shoulderR.y, swordArmDeg);

    // Head (pivoted at Neck)
    this.drawPartWithPivot(targetCtx, 'head', neck.x, neck.y, headDeg);

    // Left Arm + Shield (pivoted at ShoulderL)
    this.drawPartWithPivot(targetCtx, 'left_arm_shield', shoulderL.x, shoulderL.y, shieldArmDeg);

    // Subtle chest gleam if block glow active
    if (pose.blockGlow > 0.05) {
      targetCtx.save();
      targetCtx.globalCompositeOperation = 'lighter';
      targetCtx.globalAlpha = pose.blockGlow * 0.4;
      this.drawPartWithPivot(targetCtx, 'left_arm_shield', shoulderL.x, shoulderL.y, shieldArmDeg);
      targetCtx.restore();
    }

    targetCtx.restore(); // end upper body hierarchy
    targetCtx.restore(); // end character transform

    if (useFlashBuffer) {
      const s = this.scratchCanvas;
      this.scratchCtx.save();
      this.scratchCtx.globalCompositeOperation = 'source-atop';
      this.scratchCtx.fillStyle = `rgba(255, 224, 175, ${Math.min(0.65, pose.hitFlash * 0.72)})`;
      this.scratchCtx.fillRect(0, 0, s.width, s.height);
      this.scratchCtx.restore();

      ctx.drawImage(s, footX - s.width * 0.5, footY - s.height * 0.85);
    }
    void chest;
  }
}
