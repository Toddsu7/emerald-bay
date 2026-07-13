// Kansas operator age gate (BUILD SPEC §7), built to the ACTUAL Kansas band 12–20
// — NOT the 2024 registration form's "12–16" (the form is wrong; §12.2).
//
//   Under 12 : cannot be registered as an operator, certificate or not.
//   12–20    : primary attests — holds a KS boater-ed certificate OR will operate
//              only under direct supervision — plus a liability acknowledgment.
//   21+      : standard.

export type AgeBand = 'under12' | '12-20' | '21plus';

export function ageBand(age: number): AgeBand {
  if (age < 12) return 'under12';
  if (age <= 20) return '12-20';
  return '21plus';
}

export interface OperatorAttestation {
  age: number;
  boaterEdAttested: boolean;
  supervisionOnly: boolean;
  liabilityAck: boolean;
}

export interface AgeGateResult {
  ok: boolean;
  error?: string;
  /** Values to persist on the member row when ok. */
  boaterEdAttested: boolean;
  supervisionOnly: boolean;
}

export function checkAgeGate(a: OperatorAttestation): AgeGateResult {
  if (!Number.isFinite(a.age) || a.age < 0 || a.age > 120) {
    return { ok: false, error: 'Enter a valid age.', boaterEdAttested: false, supervisionOnly: false };
  }
  const band = ageBand(a.age);

  if (band === 'under12') {
    return {
      ok: false,
      error: 'Under 12 can’t be registered as an operator (Kansas law).',
      boaterEdAttested: false,
      supervisionOnly: false,
    };
  }

  if (band === '12-20') {
    if (!a.boaterEdAttested && !a.supervisionOnly) {
      return {
        ok: false,
        error:
          'For ages 12–20, attest to a Kansas boater-education certificate OR supervision-only.',
        boaterEdAttested: false,
        supervisionOnly: false,
      };
    }
    if (!a.liabilityAck) {
      return {
        ok: false,
        error: 'For ages 12–20, the liability acknowledgment is required.',
        boaterEdAttested: false,
        supervisionOnly: false,
      };
    }
    return { ok: true, boaterEdAttested: a.boaterEdAttested, supervisionOnly: a.supervisionOnly };
  }

  // 21+
  return { ok: true, boaterEdAttested: a.boaterEdAttested, supervisionOnly: false };
}
