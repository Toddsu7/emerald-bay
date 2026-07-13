'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentMember } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkAgeGate } from '@/lib/agegate';

export type AddMemberResult = { ok: true; message?: string } | { ok: false; error: string };

export interface AddMemberInput {
  firstName: string;
  lastName: string;
  email?: string;
  mobile?: string;
  age: number;
  boaterEdAttested: boolean;
  supervisionOnly: boolean;
  liabilityAck: boolean;
}

/**
 * The primary adds a household member (§7). Household-scoped, not an admin task —
 * every household does this for itself. Enforces the Kansas age gate and sends the
 * new member their own magic-link invite (email only; SMS invites need phone auth).
 */
export async function addMember(input: AddMemberInput): Promise<AddMemberResult> {
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: 'You must be signed in.' };

  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  // "Invalid names get disabled" (rules doc, §7): both required, non-empty.
  if (!firstName || !lastName) {
    return { ok: false, error: 'A valid first and last name are both required.' };
  }
  const email = input.email?.trim() || null;
  const mobile = input.mobile?.trim() || null;
  if (!email && !mobile) {
    return { ok: false, error: 'Provide an email or a mobile number.' };
  }

  const gate = checkAgeGate({
    age: input.age,
    boaterEdAttested: input.boaterEdAttested,
    supervisionOnly: input.supervisionOnly,
    liabilityAck: input.liabilityAck,
  });
  if (!gate.ok) return { ok: false, error: gate.error! };

  const admin = createAdminClient();
  const birthYear = new Date().getFullYear() - Math.floor(input.age);

  const { error } = await admin.from('members').insert({
    household_id: member.householdId,
    first_name: firstName,
    last_name: lastName,
    email,
    mobile,
    role: 'member',
    birth_year: birthYear,
    boater_ed_attested: gate.boaterEdAttested,
    supervision_only: gate.supervisionOnly,
  });
  if (error) return { ok: false, error: error.message };

  // Magic-link invite (email only). Non-fatal if it fails — the member exists and
  // will be linked by email on their first login anyway.
  let inviteNote = '';
  if (email) {
    const site = process.env.NEXT_PUBLIC_SITE_URL || '';
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${site}/auth/callback`,
    });
    if (inviteErr) inviteNote = ' (invite email could not be sent — they can still sign in from the login page)';
  } else {
    inviteNote = ' (no email on file — they’ll need one to sign in, or add SMS auth later)';
  }

  revalidatePath('/household');
  return { ok: true, message: `Added ${firstName} ${lastName}.${inviteNote}` };
}
