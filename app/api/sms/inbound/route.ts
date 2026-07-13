// Inbound SMS (BUILD SPEC §9): exactly two commands, LAUNCH and PASS. NOT a
// conversational check-in — check-in needs hull selection, which SMS can't carry
// (§9). So LAUNCH auto-starts only when the household has exactly one available
// hull; otherwise we point them at the app. ⚠ Board decision flagged in handoff:
// how should SMS LAUNCH behave for multi-hull households?
import { type NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { engineMessage } from '@/lib/errors';

export const dynamic = 'force-dynamic';

function twiml(message: string) {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`,
    { headers: { 'Content-Type': 'text/xml' } },
  );
}

/** Twilio request signature validation (best-effort; only when token is set). */
function validSignature(url: string, params: Record<string, string>, signature: string | null): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return true; // dormant / dev: skip
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  return expected === signature;
}

const digits = (s: string) => s.replace(/\D/g, '').slice(-10);

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  const url = `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/api/sms/inbound`;
  if (!validSignature(url, params, req.headers.get('x-twilio-signature'))) {
    return NextResponse.json({ error: 'bad signature' }, { status: 403 });
  }

  const from = digits(params.From ?? '');
  const command = (params.Body ?? '').trim().toUpperCase();
  if (command !== 'LAUNCH' && command !== 'PASS') {
    return twiml('Reply LAUNCH to claim your slot or PASS to skip.');
  }

  const admin = createAdminClient();

  // Match the sender to a member by mobile (last 10 digits).
  const { data: members } = await admin.from('members').select('id, household_id, mobile');
  const member = (members ?? []).find((m) => m.mobile && digits(m.mobile) === from);
  if (!member) return twiml('We don’t recognize this number. Please use the app.');

  // Find the household's current offer.
  const { data: offer } = await admin
    .from('queue_entries')
    .select('id, lake_id, lakes(name)')
    .eq('household_id', member.household_id)
    .eq('status', 'offered')
    .maybeSingle();
  if (!offer) return twiml('No active offer for your household right now.');

  if (command === 'PASS') {
    const { error } = await admin.rpc('pass_offer', { p_queue_entry_id: offer.id });
    if (error) return twiml(engineMessage(error));
    return twiml('Passed. We’ll offer the next open slot.');
  }

  // LAUNCH — need hull(s). Find available checkinable hulls not already out.
  const { data: hulls } = await admin
    .from('watercraft')
    .select('id, sticker_number')
    .eq('household_id', member.household_id)
    .eq('is_checkinable', true)
    .eq('active', true);
  const { data: inUse } = await admin
    .from('session_watercraft')
    .select('watercraft_id, sessions!inner(ended_at)')
    .is('sessions.ended_at', null);
  const inUseIds = new Set((inUse ?? []).map((r) => (r as { watercraft_id: string }).watercraft_id));
  const available = (hulls ?? []).filter((h) => !inUseIds.has(h.id));

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  if (available.length === 0) {
    return twiml('No available watercraft to launch. Open the app to check.');
  }
  if (available.length > 1) {
    return twiml(`You have multiple watercraft — open the app to choose: ${site}/checkin`);
  }

  const { error } = await admin.rpc('accept_offer', {
    p_queue_entry_id: offer.id,
    p_started_by: member.id,
    p_hulls: [{ watercraft_id: available[0].id, is_guest_operated: false, guest_name: null }],
  });
  if (error) return twiml(engineMessage(error));
  const lakeName = (offer as { lakes?: { name?: string } }).lakes?.name ?? 'the lake';
  return twiml(`Launched #${available[0].sticker_number} on ${lakeName}. Have fun!`);
}
