// Store a web-push device subscription for the signed-in member (§9). The client
// service worker + subscribe flow is a documented follow-up; this endpoint is
// server-ready so subscriptions persist as soon as that lands.
import { type NextRequest, NextResponse } from 'next/server';
import { getCurrentMember } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sub = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  if (!sub?.endpoint) return NextResponse.json({ error: 'bad subscription' }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from('push_subscriptions')
    .upsert(
      { member_id: member.id, endpoint: sub.endpoint, subscription: sub },
      { onConflict: 'endpoint' },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
