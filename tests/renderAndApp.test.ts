import { beforeAll, describe, expect, it } from 'vitest';
import { Direction, ItemType, MonMode, PlrMode, idx112 } from 'diablo-109b-engine';
import { SANCTUM_MAX_X, SANCTUM_MIN_X, WarriorSanctumSession } from '../src/engine/warriorSession.js';

function makeMockCtx() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return new Proxy(
    {
      canvas: { width: 844, height: 390 },
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      lineCap: 'round',
      lineJoin: 'round',
      font: '12px sans-serif',
      textAlign: 'center',
      textBaseline: 'middle',
      shadowColor: 'transparent',
      shadowBlur: 0,
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      measureText: (t: string) => ({ width: t.length * 7 }),
    } as unknown as CanvasRenderingContext2D,
    {
      get(target, prop) {
        const rec = target as unknown as Record<PropertyKey, unknown>;
        if (prop in rec) return rec[prop];
        return noop;
      },
      set(target, prop, value) {
        (target as unknown as Record<PropertyKey, unknown>)[prop] = value;
        return true;
      },
    },
  );
}

describe('WarriorRig2D & SanctumRenderer runtime smoke', () => {
  beforeAll(() => {
    const mockCtx = makeMockCtx();
    (globalThis as unknown as Record<string, unknown>).Image = class {
      complete = true;
      naturalWidth = 512;
      naturalHeight = 512;
      width = 512;
      height = 512;
      onload: (() => void) | null = null;
      set src(_v: string) {
        this.onload?.();
      }
    };
    (globalThis as unknown as Record<string, unknown>).document = {
      createElement: () => ({
        width: 240,
        height: 240,
        getContext: () => mockCtx,
      }),
    };
  });

  it('renders WarriorRig2D across all PlrMode states & directions without throwing', async () => {
    const { WarriorRig2D } = await import('../src/render/warriorRig2D.js');
    const rig = new WarriorRig2D();
    expect(rig.loaded).toBe(true);

    const ctx = makeMockCtx();
    const modes = [
      PlrMode.PM_STAND,
      PlrMode.PM_WALK,
      PlrMode.PM_ATTACK,
      PlrMode.PM_BLOCK,
      PlrMode.PM_GOTHIT,
      PlrMode.PM_DEATH,
    ];
    const dirs = [Direction.DIR_S, Direction.DIR_SE, Direction.DIR_W, Direction.DIR_NW, Direction.DIR_NE];

    for (const mode of modes) {
      for (const dir of dirs) {
        for (let frame = 1; frame <= 16; frame += 5) {
          expect(() =>
            rig.render(ctx, 400, 220, 0.72, {
              mode,
              dir,
              animFrame: frame,
              animLen: 16,
              timeSec: frame * 0.15,
              hitFlash: mode === PlrMode.PM_GOTHIT ? 0.8 : 0,
              blockGlow: mode === PlrMode.PM_BLOCK ? 0.9 : 0,
              powerCleaveTimer: 0.4,
            }),
          ).not.toThrow();
        }
      }
    }
  });

  it('drives SanctumRenderer across combat ticks, cues, shockwaves, and wave spawning', async () => {
    const { SanctumRenderer } = await import('../src/render/sanctumRenderer.js');
    const renderer = new SanctumRenderer();
    const session = new WarriorSanctumSession('렌더검증');
    const ctx = makeMockCtx();
    const world = session.ctx.world;

    expect(() => renderer.markTapTile(50, 50)).not.toThrow();
    const picked = renderer.screenToWorld(422, 200, 844, 390);
    expect(picked.tx).toBeGreaterThanOrEqual(SANCTUM_MIN_X - 15);
    expect(picked.tx).toBeLessThanOrEqual(SANCTUM_MAX_X + 15);

    session.powerCleaveAction();
    for (let i = 0; i < 20; i++) {
      if (i === 5) session.attackAction();
      const out = session.step(1);
      renderer.ingestCombatCues(out.combatCues, '렌더검증');
      const details = session.getWarriorDetails();
      renderer.updateEffects(0.05, out.snapshot, details.pxoff, details.pyoff);
      expect(() =>
        renderer.renderScene(
          ctx,
          844,
          390,
          out.snapshot,
          details.pxoff,
          details.pyoff,
          i * 0.05,
          (x, y) => world.nSolidTable[world.dPiece[idx112(x, y)]!] !== 0,
          (idx) => (world.item[idx]?._itype ?? ItemType.ITYPE_NONE) === ItemType.ITYPE_GOLD,
        ),
      ).not.toThrow();
    }

    // Exercise living/dead monster branch coverage
    const m0 = world.monster[world.monstactive[0]!]!;
    expect(m0._mmode === MonMode.MM_DEATH || m0._mhitpoints > 0).toBe(true);
  });
});
