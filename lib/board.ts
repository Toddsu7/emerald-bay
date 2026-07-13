// Live board state (BUILD SPEC §6). Association-public read; computes each
// session's "ends at" from hours (§2.2) ∧ the queue hard end (§2.4), and the
// current fair-share cap (§2.6). Uses the RLS server client — board tables are
// readable by any signed-in member.
import { createClient } from '@/lib/supabase/server';
import { sunTimesToday, chicagoClock } from '@/lib/sun';
import { combinedWindow } from '@/lib/hours';
import { effectiveEnd } from '@/lib/session';
import { computeCap } from '@/lib/caps';
import { isCheckinableType, type CheckinableCraftType, type CraftType } from '@/lib/types';

export interface BoardHull {
  sticker: number;
  craftType: string;
  photoUrl: string | null;
  thumbUrl: string | null;
  isGuest: boolean;
  guestName: string | null;
}
export interface BoardSession {
  id: string;
  householdName: string;
  startedAt: string;
  startedClock: string;
  endsClock: string | null;
  endsAt: number | null;
  lastCall: boolean;
  hulls: BoardHull[];
}
export interface BoardQueueItem {
  position: number;
  householdName: string;
  offered: boolean;
}
export interface LakeBoard {
  id: string;
  name: string;
  capacity: number;
  openHulls: number;
  slots: number;
  cap: number;
  householdsWaiting: number;
  sessions: BoardSession[];
  queue: BoardQueueItem[];
  sessionsAheadEndClocks: string[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function getBoard(): Promise<LakeBoard[]> {
  const supabase = await createClient();
  const sun = sunTimesToday();

  const { data: lakes } = await supabase.from('lakes').select('*').order('name');
  if (!lakes) return [];

  const boards: LakeBoard[] = [];
  for (const lake of lakes) {
    const { data: sessionsRaw } = await supabase
      .from('sessions')
      .select(
        'id, household_id, started_at, hard_end_at, last_call, households(name), session_watercraft(is_guest_operated, guest_name, watercraft(sticker_number, craft_type, photo_url, thumb_url))',
      )
      .eq('lake_id', lake.id)
      .is('ended_at', null)
      .order('started_at');

    const { data: queueRaw } = await supabase
      .from('queue_entries')
      .select('id, household_id, joined_at, status, households(name)')
      .eq('lake_id', lake.id)
      .in('status', ['waiting', 'offered'])
      .order('joined_at');

    const sessions: BoardSession[] = (sessionsRaw ?? []).map((s: any) => {
      const hulls: BoardHull[] = (s.session_watercraft ?? []).map((sw: any) => ({
        sticker: sw.watercraft?.sticker_number,
        craftType: sw.watercraft?.craft_type,
        photoUrl: sw.watercraft?.photo_url ?? null,
        thumbUrl: sw.watercraft?.thumb_url ?? null,
        isGuest: sw.is_guest_operated,
        guestName: sw.guest_name ?? null,
      }));
      const crafts = hulls
        .map((h) => h.craftType as CraftType)
        .filter((t): t is CheckinableCraftType => isCheckinableType(t));
      let endsAt: number | null = null;
      if (crafts.length > 0) {
        const hoursLatest = combinedWindow(crafts, sun).latest;
        const hardEnd = s.hard_end_at ? new Date(s.hard_end_at) : null;
        endsAt = effectiveEnd(hoursLatest, hardEnd).getTime();
      }
      return {
        id: s.id,
        householdName: s.households?.name ?? '',
        startedAt: s.started_at,
        startedClock: chicagoClock(new Date(s.started_at)),
        endsClock: endsAt ? chicagoClock(new Date(endsAt)) : null,
        endsAt,
        lastCall: s.last_call,
        hulls,
      };
    });

    const openHulls = sessions.reduce((n, s) => n + s.hulls.length, 0);
    const householdsOnWater = new Set(
      (sessionsRaw ?? []).map((s: any) => s.household_id),
    ).size;
    const householdsWaiting = new Set(
      (queueRaw ?? []).map((q: any) => q.household_id),
    ).size;

    const queue: BoardQueueItem[] = (queueRaw ?? []).map((q: any, i: number) => ({
      position: i + 1,
      householdName: q.households?.name ?? '',
      offered: q.status === 'offered',
    }));

    const sessionsAheadEndClocks = sessions
      .filter((s) => s.endsAt !== null)
      .sort((a, b) => (a.endsAt! - b.endsAt!))
      .map((s) => chicagoClock(new Date(s.endsAt!)));

    boards.push({
      id: lake.id,
      name: lake.name,
      capacity: lake.capacity,
      openHulls,
      slots: lake.capacity - openHulls,
      cap: computeCap({
        lakeCapacity: lake.capacity,
        householdsOnWater,
        householdsWaiting,
      }),
      householdsWaiting,
      sessions,
      queue,
      sessionsAheadEndClocks,
    });
  }
  return boards;
}
