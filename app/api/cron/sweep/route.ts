// The every-minute sweep (BUILD SPEC §5). Vercel Cron free tier is once/day, so an
// external pinger (cron-job.org) hits this endpoint every minute, protected by
// CRON_SECRET. It ensures today's sun_times row, then runs the DB sweep (end
// expired sessions, flag no-checkout violations, expire stale offers, promote the
// queue, recompute caps).
import { type NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureSunTimes } from '@/lib/sunSync';

export const dynamic = 'force-dynamic';

async function runSweep(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 });
  }
  const header = req.headers.get('authorization');
  const param = req.nextUrl.searchParams.get('secret');
  const authorized = header === `Bearer ${secret}` || param === secret;
  if (!authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await ensureSunTimes();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('sweep');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, result: data });
}

export async function GET(req: NextRequest) {
  return runSweep(req);
}
export async function POST(req: NextRequest) {
  return runSweep(req);
}
