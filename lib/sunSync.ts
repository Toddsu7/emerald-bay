// Keep the sun_times table populated. The engine (0003) enforces hours from this
// table and REFUSES check-in if today's row is missing, so we upsert today's row
// before check-in is possible and on every cron sweep.
import { createAdminClient } from '@/lib/supabase/admin';
import { sunTimesForDate, chicagoCivilDate } from '@/lib/sun';

export async function ensureSunTimes(civilDate: string = chicagoCivilDate()): Promise<void> {
  const admin = createAdminClient();
  const { sunrise, sunset } = sunTimesForDate(civilDate);
  await admin.from('sun_times').upsert(
    {
      civil_date: civilDate,
      sunrise: sunrise.toISOString(),
      sunset: sunset.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'civil_date' },
  );
}
