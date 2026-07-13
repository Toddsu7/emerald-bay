// Turn an engine refusal into a human message WITH live numbers (§2.6/§4). Called
// on the error path of a check-in/launch action, where we have the lake, household,
// and selected hulls in hand — so we can say "You're at your cap of 2 while 1
// household is waiting" or "Jet skis can't launch before 10:00 AM", not a catch-all.
import { createAdminClient } from '@/lib/supabase/admin';
import { matchCode, engineMessage } from '@/lib/errors';
import { computeCap } from '@/lib/caps';
import { combinedWindow } from '@/lib/hours';
import { sunTimesToday, chicagoClock } from '@/lib/sun';
import { isCheckinableType, type CheckinableCraftType, type CraftType } from '@/lib/types';

export interface RefusalContext {
  lakeId: string;
  householdId: string;
  hullIds: string[];
}

export async function describeCheckInError(
  err: unknown,
  ctx: RefusalContext,
): Promise<string> {
  const code = matchCode(err);
  if (!code) return engineMessage(err);
  const admin = createAdminClient();
  const now = new Date();

  try {
    switch (code) {
      case 'COOLDOWN': {
        const { data } = await admin
          .from('cooldowns')
          .select('expires_at')
          .eq('household_id', ctx.householdId)
          .gt('expires_at', now.toISOString())
          .order('expires_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return data?.expires_at
          ? `Your household is in cooldown until ${chicagoClock(new Date(data.expires_at))}. It blocks check-in and the queue.`
          : engineMessage(err);
      }

      case 'SUSPENDED': {
        const { data } = await admin
          .from('households')
          .select('suspended_until')
          .eq('id', ctx.householdId)
          .maybeSingle();
        return data?.suspended_until
          ? `Your household is suspended until ${new Date(data.suspended_until).toLocaleDateString()}.`
          : 'Your household is suspended and can’t check in or queue.';
      }

      case 'OVER_CAP': {
        const [{ data: lake }, { data: openSessions }, { data: queue }, { data: mine }] =
          await Promise.all([
            admin.from('lakes').select('capacity').eq('id', ctx.lakeId).maybeSingle(),
            admin.from('sessions').select('household_id').eq('lake_id', ctx.lakeId).is('ended_at', null),
            admin
              .from('queue_entries')
              .select('household_id')
              .eq('lake_id', ctx.lakeId)
              .in('status', ['waiting', 'offered']),
            admin
              .from('sessions')
              .select('id, session_watercraft(watercraft_id)')
              .eq('lake_id', ctx.lakeId)
              .eq('household_id', ctx.householdId)
              .is('ended_at', null),
          ]);
        const householdsOnWater = new Set((openSessions ?? []).map((s) => s.household_id)).size;
        const householdsWaiting = new Set((queue ?? []).map((q) => q.household_id)).size;
        const cap = computeCap({
          lakeCapacity: lake?.capacity ?? 0,
          householdsOnWater,
          householdsWaiting,
        });
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const held = (mine ?? []).reduce(
          (n: number, s: any) => n + (s.session_watercraft?.length ?? 0),
          0,
        );
        const waitingPhrase =
          householdsWaiting === 1
            ? '1 household is waiting'
            : `${householdsWaiting} households are waiting`;
        return `That would put you over your cap of ${cap} watercraft while ${waitingPhrase}. You have ${held} out now.`;
      }

      case 'OUT_OF_HOURS': {
        const { data: hulls } = await admin
          .from('watercraft')
          .select('craft_type')
          .in('id', ctx.hullIds);
        const crafts = (hulls ?? [])
          .map((h) => h.craft_type as CraftType)
          .filter((t): t is CheckinableCraftType => isCheckinableType(t));
        if (crafts.length === 0) return engineMessage(err);
        const sun = sunTimesToday(now);
        const win = combinedWindow(crafts, sun);
        const hasJet = crafts.includes('Jet Ski');
        if (now.getTime() < win.earliest.getTime()) {
          return hasJet
            ? `Jet skis can’t launch before ${chicagoClock(win.earliest)}.`
            : `Too early — that can’t launch until ${chicagoClock(win.earliest)}.`;
        }
        return hasJet
          ? `Jet skis must be off the water by sunset (${chicagoClock(win.latest)}).`
          : `Too late — that must be off the water by ${chicagoClock(win.latest)}.`;
      }

      case 'LAKE_FULL': {
        const [{ data: lake }, { data: sw }] = await Promise.all([
          admin.from('lakes').select('capacity').eq('id', ctx.lakeId).maybeSingle(),
          admin
            .from('session_watercraft')
            .select('watercraft_id, sessions!inner(lake_id, ended_at)')
            .eq('sessions.lake_id', ctx.lakeId)
            .is('sessions.ended_at', null),
        ]);
        const open = (lake?.capacity ?? 0) - (sw?.length ?? 0);
        return open <= 0
          ? 'The lake is full — no open slots. Join the queue and we’ll text you when one opens.'
          : `Only ${open} open slot${open === 1 ? '' : 's'} — you selected more than that.`;
      }

      default:
        return engineMessage(err);
    }
  } catch {
    return engineMessage(err); // enrichment failed → fall back to the static message
  }
}
