import { describe, it, expect } from 'vitest';
import { ageBand, checkAgeGate } from './agegate';

describe('ageBand — Kansas 12–20 (§7)', () => {
  it('bands the boundaries correctly', () => {
    expect(ageBand(11)).toBe('under12');
    expect(ageBand(12)).toBe('12-20');
    expect(ageBand(20)).toBe('12-20');
    expect(ageBand(21)).toBe('21plus');
  });
});

describe('checkAgeGate', () => {
  const base = { boaterEdAttested: false, supervisionOnly: false, liabilityAck: false };

  it('rejects under 12 as an operator regardless of attestation', () => {
    const r = checkAgeGate({ ...base, age: 11, boaterEdAttested: true, liabilityAck: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Under 12/);
  });

  it('12–20 needs cert-or-supervision AND liability ack', () => {
    expect(checkAgeGate({ ...base, age: 15 }).ok).toBe(false); // nothing attested
    expect(checkAgeGate({ ...base, age: 15, boaterEdAttested: true }).ok).toBe(false); // no ack
    expect(
      checkAgeGate({ age: 15, boaterEdAttested: true, supervisionOnly: false, liabilityAck: true }).ok,
    ).toBe(true);
    expect(
      checkAgeGate({ age: 15, boaterEdAttested: false, supervisionOnly: true, liabilityAck: true }).ok,
    ).toBe(true);
  });

  it('12–20 persists the attested flags', () => {
    const r = checkAgeGate({ age: 16, boaterEdAttested: false, supervisionOnly: true, liabilityAck: true });
    expect(r).toMatchObject({ ok: true, boaterEdAttested: false, supervisionOnly: true });
  });

  it('21+ is standard and never supervision-only', () => {
    const r = checkAgeGate({ age: 40, boaterEdAttested: false, supervisionOnly: true, liabilityAck: false });
    expect(r.ok).toBe(true);
    expect(r.supervisionOnly).toBe(false);
  });

  it('rejects nonsense ages', () => {
    expect(checkAgeGate({ ...base, age: -3 }).ok).toBe(false);
    expect(checkAgeGate({ ...base, age: 200 }).ok).toBe(false);
  });
});
