// Domain types shared across the pure libs and the app.

// The full Zoho picklist — 7 values. Only the four powered wake-making types are
// checkinable; Sail boat / E-Foil / Other are registered but never consume a slot.
// (Sail boat & Other are deliberately retained though unused today — §10 vs §3 is
// not a conflict: the picklist offers 7, the current data uses 5.)
export const CRAFT_TYPES = [
  'Pontoon',
  'Jet Ski',
  'Ski/Surf boat',
  'Fishing boat',
  'Sail boat',
  'E-Foil',
  'Other',
] as const;
export type CraftType = (typeof CRAFT_TYPES)[number];

export const CHECKINABLE_CRAFT_TYPES = [
  'Pontoon',
  'Jet Ski',
  'Ski/Surf boat',
  'Fishing boat',
] as const;
export type CheckinableCraftType = (typeof CHECKINABLE_CRAFT_TYPES)[number];

export function isCheckinableType(t: CraftType): t is CheckinableCraftType {
  return (CHECKINABLE_CRAFT_TYPES as readonly string[]).includes(t);
}

export type LakeName = 'East' | 'West';

// The instants that define a single day's legal windows for one lake location.
// tenAmLocal is the fixed 10:00-AM wall time (jet-ski floor, §2.2), resolved to a
// UTC instant for the lake's timezone on that date.
export interface SunTimes {
  sunrise: Date;
  sunset: Date;
  tenAmLocal: Date;
}
