/**
 * @file soundSynth.ts
 * @description Zero-dependency Web Audio API procedural sound effects mapped to
 * `diablo-109b-engine` AudioCues & CombatCues.
 */

import { SfxId, type AudioCue } from 'diablo-109b-engine';
import type { CombatCue } from '../engine/warriorSession.js';

export class SoundSynth {
  private ctx: AudioContext | null = null;
  muted = false;
  private lastStepMs = 0;

  unlock(): void {
    if (this.muted) return;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  handleAudioCues(cues: readonly AudioCue[]): void {
    if (this.muted || !this.ctx) return;
    for (const cue of cues) {
      if (cue.kind !== 'sfx' || cue.sfxId === undefined) continue;
      if (cue.sfxId === SfxId.PS_WALK1) {
        const now = performance.now();
        if (now - this.lastStepMs > 190) {
          this.lastStepMs = now;
          this.playFootstep();
        }
      } else if (cue.sfxId === SfxId.PS_SWING) {
        this.playSwing();
      } else if (cue.sfxId === SfxId.IS_ISWORD) {
        this.playShieldClang();
      } else if (cue.sfxId === SfxId.PS_WARR69) {
        this.playHurt();
      }
    }
  }

  handleCombatCues(cues: readonly CombatCue[]): void {
    if (this.muted || !this.ctx) return;
    for (const c of cues) {
      switch (c.kind) {
        case 'damage_monster':
          this.playHitImpact(false);
          break;
        case 'kill_monster':
          this.playHitImpact(true);
          break;
        case 'block_player':
          this.playShieldClang();
          break;
        case 'power_cleave':
          this.playPowerCleave();
          break;
        case 'heal':
          this.playPotionChime();
          break;
        case 'level_up':
          this.playLevelUpFanfare();
          break;
        case 'loot':
        case 'object_break':
          this.playLootPop();
          break;
      }
    }
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    gainPeak: number,
    delay = 0,
  ): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(25, freqEnd), t0 + duration);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  playFootstep(): void {
    this.playTone(135, 62, 0.055, 'triangle', 0.06);
  }

  playSwing(): void {
    this.playTone(420, 120, 0.14, 'sawtooth', 0.08);
    this.playTone(680, 210, 0.11, 'sine', 0.05, 0.02);
  }

  playHitImpact(heavy: boolean): void {
    this.playTone(heavy ? 185 : 230, 52, heavy ? 0.18 : 0.11, 'square', heavy ? 0.13 : 0.09);
    if (heavy) {
      this.playTone(540, 290, 0.22, 'triangle', 0.09, 0.03);
    }
  }

  playShieldClang(): void {
    this.playTone(980, 620, 0.16, 'triangle', 0.11);
    this.playTone(1420, 960, 0.14, 'sine', 0.08, 0.01);
  }

  playHurt(): void {
    this.playTone(170, 75, 0.14, 'sawtooth', 0.1);
  }

  playPowerCleave(): void {
    this.playTone(220, 55, 0.28, 'sawtooth', 0.16);
    this.playTone(660, 160, 0.24, 'triangle', 0.12);
  }

  playPotionChime(): void {
    this.playTone(523, 784, 0.12, 'sine', 0.09);
    this.playTone(784, 1046, 0.18, 'sine', 0.08, 0.07);
  }

  playLevelUpFanfare(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      this.playTone(n, n * 1.01, 0.22, 'triangle', 0.11, i * 0.085);
    });
  }

  playLootPop(): void {
    this.playTone(640, 960, 0.09, 'sine', 0.08);
  }
}
