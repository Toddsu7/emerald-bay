// Violation types a board member enters by hand (§2.8). Most of what the board
// actually enforces is NOT auto-detectable — music, speed, wake distance, decal
// placement, a boat making a wake that never checked in. Each maps to a (track,
// kind); track drives which schedule/counter applies (music has its own, §2.8).
export const BOARD_VIOLATION_TYPES = [
  { track: 'music', kind: 'music', label: 'Music / profanity' },
  { track: 'other', kind: 'speed', label: 'Speeding' },
  { track: 'other', kind: 'wake_distance', label: 'Wake distance' },
  { track: 'other', kind: 'decal', label: 'Decal placement' },
  { track: 'app_usage', kind: 'no_checkin', label: 'Wake without checking in' },
  { track: 'app_usage', kind: 'no_checkout', label: 'Failure to check out (observed)' },
  { track: 'other', kind: 'other', label: 'Other' },
] as const;

export type BoardViolationType = (typeof BOARD_VIOLATION_TYPES)[number];

export function violationLabel(track: string, kind: string): string {
  const hit = BOARD_VIOLATION_TYPES.find((t) => t.track === track && t.kind === kind);
  return hit ? hit.label : `${track}/${kind}`;
}
