import { describe, expect, it } from 'vitest';
import { Direction, PlrClass, PlrMode } from 'diablo-109b-engine';
import { WarriorSanctumSession, getWarriorBlueprint } from '../src/engine/warriorSession.js';

describe('WarriorSanctumSession (diablo-109b-engine integration)', () => {
  it('initializes authentic Warrior class stats, equipment, and 18x18 sanctum via engine', () => {
    const bp = getWarriorBlueprint();
    expect(bp.classId).toBe(PlrClass.PC_WARRIOR);
    expect(bp.str).toBe(30);
    expect(bp.vit).toBe(25);
    expect(bp.baseHp).toBe(70);

    const session = new WarriorSanctumSession('테스트전사');
    const details = session.getWarriorDetails();
    expect(details.name).toBe('테스트전사');
    expect(details.level).toBe(1);
    expect(details.hp).toBeGreaterThan(0);
    expect(details.minDmg).toBeGreaterThanOrEqual(2);
    expect(details.beltPotions).toBe(2);
    expect(session.getLivingMonsterCount()).toBe(3);
  });

  it('drives real 20Hz A* movement, melee combat, kills, XP, and belt potion consumption', () => {
    const session = new WarriorSanctumSession('기사아서', 0x12345);
    const startDetails = session.getWarriorDetails();

    // 1. Steer warrior E via real CMD_WALKXY
    session.steerDirection(Direction.DIR_E);
    session.step(12);
    const moved = session.getWarriorDetails();
    expect(moved.px !== startDetails.px || moved.py !== startDetails.py).toBe(true);

    // 2. Engage and defeat monsters via real CMD_ATTACKID + plrHitMonst + mStartKill
    for (let round = 0; round < 160; round++) {
      if (session.getLivingMonsterCount() === 0) break;
      session.attackAction();
      session.step(4);
    }

    expect(session.kills).toBeGreaterThanOrEqual(1);
    const diag = session.getDiagnostics();
    expect(diag.hookStats.mStartHit + diag.hookStats.mStartKill).toBeGreaterThan(0);
    expect(diag.tick).toBeGreaterThan(0);

    // 3. Drink healing potion from belt
    session.ctx.world.plr[0]!._pHitPoints = 20 << 6;
    const used = session.usePotionBeltSlot(0);
    expect(used).toBe(true);
    expect(session.getWarriorDetails().hp).toBeGreaterThan(20);
    expect(session.getWarriorDetails().beltPotions).toBe(1);

    // 4. Power cleave consumes mana and triggers attack mode
    const beforeMana = session.getWarriorDetails().mana;
    const cleaved = session.powerCleaveAction();
    expect(cleaved).toBe(true);
    expect(session.getWarriorDetails().mana).toBe(beforeMana - 4);
    expect(session.getWarriorDetails().mode).toBe(PlrMode.PM_ATTACK);

    // 5. Operate chest via walkToTile + step
    session.walkToTile(49, 44);
    session.step(60);
    expect(session.getDiagnostics().hookStats.operateObject).toBeGreaterThanOrEqual(1);
  });
});
