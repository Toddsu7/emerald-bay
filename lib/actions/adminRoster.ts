'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { getCurrentMember } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isCheckinableType, type CraftType } from '@/lib/types';

// ── shared result shapes ─────────────────────────────────────────────────────
export type Result<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string };

export interface HouseholdSearchResult {
  id: string;
  name: string;
  address: string | null;
  memberCount: number;
  hullCount: number;
}
export interface RosterMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  mobile: string | null;
  role: 'primary' | 'member';
  isAdmin: boolean;
  age: number | null;
  active: boolean;
  hasLogin: boolean;
}
export interface RosterHull {
  id: string;
  sticker: number;
  craftType: CraftType;
  isCheckinable: boolean;
  manufacturer: string | null;
  model: string | null;
  active: boolean;
}
export interface HouseholdDetail {
  id: string;
  name: string;
  address: string | null;
  status: string;
  members: RosterMember[];
  hulls: RosterHull[];
}

async function requireBoard() {
  const m = await getCurrentMember();
  return m?.isAdmin ? m : null;
}

const thisYear = () => new Date().getFullYear();
const ageToBirthYear = (age: number) => thisYear() - Math.floor(age);
const birthYearToAge = (by: number | null) => (by == null ? null : thisYear() - by);

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── search ───────────────────────────────────────────────────────────────────
export async function searchHouseholds(query: string): Promise<Result<HouseholdSearchResult[]>> {
  if (!(await requireBoard())) return { ok: false, error: 'Board only.' };
  const admin = createAdminClient();
  const q = query.trim();
  let sel = admin.from('households').select('id, name, address').order('name').limit(30);
  if (q) sel = sel.or(`name.ilike.%${q}%,address.ilike.%${q}%`);
  const { data: households, error } = await sel;
  if (error) return { ok: false, error: error.message };
  const ids = (households ?? []).map((h) => h.id);
  if (ids.length === 0) return { ok: true, data: [] };

  const [{ data: members }, { data: hulls }] = await Promise.all([
    admin.from('members').select('household_id').in('household_id', ids),
    admin.from('watercraft').select('household_id').in('household_id', ids),
  ]);
  const mCount = new Map<string, number>();
  const hCount = new Map<string, number>();
  for (const m of members ?? []) mCount.set(m.household_id, (mCount.get(m.household_id) ?? 0) + 1);
  for (const h of hulls ?? []) hCount.set(h.household_id, (hCount.get(h.household_id) ?? 0) + 1);

  return {
    ok: true,
    data: (households ?? []).map((h) => ({
      id: h.id,
      name: h.name,
      address: h.address,
      memberCount: mCount.get(h.id) ?? 0,
      hullCount: hCount.get(h.id) ?? 0,
    })),
  };
}

export async function getHouseholdDetail(householdId: string): Promise<Result<HouseholdDetail>> {
  if (!(await requireBoard())) return { ok: false, error: 'Board only.' };
  const admin = createAdminClient();
  const { data: h } = await admin
    .from('households')
    .select('id, name, address, status')
    .eq('id', householdId)
    .maybeSingle();
  if (!h) return { ok: false, error: 'Household not found.' };

  const [{ data: members }, { data: hulls }] = await Promise.all([
    admin
      .from('members')
      .select('id, first_name, last_name, email, mobile, role, is_admin, birth_year, active, auth_user_id')
      .eq('household_id', householdId)
      .order('role')
      .order('first_name'),
    admin
      .from('watercraft')
      .select('id, sticker_number, craft_type, is_checkinable, manufacturer, model, active')
      .eq('household_id', householdId)
      .order('sticker_number'),
  ]);

  return {
    ok: true,
    data: {
      id: h.id,
      name: h.name,
      address: h.address,
      status: h.status,
      members: (members ?? []).map((m: any) => ({
        id: m.id,
        firstName: m.first_name,
        lastName: m.last_name,
        email: m.email,
        mobile: m.mobile,
        role: m.role,
        isAdmin: m.is_admin,
        age: birthYearToAge(m.birth_year),
        active: m.active,
        hasLogin: m.auth_user_id != null,
      })),
      hulls: (hulls ?? []).map((w: any) => ({
        id: w.id,
        sticker: w.sticker_number,
        craftType: w.craft_type,
        isCheckinable: w.is_checkinable,
        manufacturer: w.manufacturer,
        model: w.model,
        active: w.active,
      })),
    },
  };
}

// ── members ───────────────────────────────────────────────────────────────────
export interface MemberInput {
  firstName: string;
  lastName: string;
  email?: string | null;
  mobile?: string | null;
  age?: number | null;
  role: 'primary' | 'member';
  isAdmin: boolean;
}

function validateMember(input: MemberInput): string | null {
  if (!input.firstName?.trim() || !input.lastName?.trim())
    return 'A valid first and last name are both required.';
  if (!input.email?.trim() && !input.mobile?.trim())
    return 'Provide an email or a mobile number.';
  return null;
}

export async function adminAddMember(householdId: string, input: MemberInput): Promise<Result> {
  const board = await requireBoard();
  if (!board) return { ok: false, error: 'Board only.' };
  const err = validateMember(input);
  if (err) return { ok: false, error: err };
  const admin = createAdminClient();
  const { error } = await admin.from('members').insert({
    household_id: householdId,
    first_name: input.firstName.trim(),
    last_name: input.lastName.trim(),
    email: input.email?.trim() || null,
    mobile: input.mobile?.trim() || null,
    role: input.role,
    is_admin: input.isAdmin,
    birth_year: input.age != null ? ageToBirthYear(input.age) : null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin');
  return { ok: true, message: 'Member added.' };
}

export async function adminUpdateMember(memberId: string, input: MemberInput): Promise<Result> {
  const board = await requireBoard();
  if (!board) return { ok: false, error: 'Board only.' };
  const err = validateMember(input);
  if (err) return { ok: false, error: err };
  const admin = createAdminClient();
  const { error } = await admin
    .from('members')
    .update({
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      email: input.email?.trim() || null,
      mobile: input.mobile?.trim() || null,
      role: input.role,
      is_admin: input.isAdmin,
      birth_year: input.age != null ? ageToBirthYear(input.age) : null,
    })
    .eq('id', memberId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin');
  return { ok: true, message: 'Member updated.' };
}

export async function adminSetMemberActive(memberId: string, active: boolean): Promise<Result> {
  const board = await requireBoard();
  if (!board) return { ok: false, error: 'Board only.' };
  if (memberId === board.id && !active) {
    return { ok: false, error: 'You can’t deactivate your own account.' };
  }
  const admin = createAdminClient();
  const { error } = await admin.from('members').update({ active }).eq('id', memberId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin');
  return { ok: true, message: active ? 'Member reactivated.' : 'Member deactivated.' };
}

/** Resend a magic-link invite. Works whether or not the member has logged in before. */
export async function resendInvite(memberId: string): Promise<Result> {
  const board = await requireBoard();
  if (!board) return { ok: false, error: 'Board only.' };
  const admin = createAdminClient();
  const { data: member } = await admin
    .from('members')
    .select('email')
    .eq('id', memberId)
    .maybeSingle();
  if (!member?.email) return { ok: false, error: 'That member has no email to invite.' };

  const site = process.env.NEXT_PUBLIC_SITE_URL || '';
  // New user → invite (creates + emails). Existing user → OTP magic link.
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(member.email, {
    redirectTo: `${site}/auth/callback`,
  });
  if (!inviteErr) {
    revalidatePath('/admin');
    return { ok: true, message: `Invite sent to ${member.email}.` };
  }
  // Fall back to a magic link for an already-registered user.
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { error: otpErr } = await anon.auth.signInWithOtp({
    email: member.email,
    options: { emailRedirectTo: `${site}/auth/callback` },
  });
  if (otpErr) return { ok: false, error: otpErr.message };
  return { ok: true, message: `Sign-in link sent to ${member.email}.` };
}

// ── watercraft ─────────────────────────────────────────────────────────────────
export interface HullInput {
  sticker: number;
  craftType: CraftType;
  manufacturer?: string | null;
  model?: string | null;
  active: boolean;
}

function validateHull(input: HullInput): string | null {
  if (!Number.isInteger(input.sticker) || input.sticker < 100 || input.sticker > 350)
    return 'Sticker number must be 100–350.';
  return null;
}

export async function adminAddWatercraft(householdId: string, input: HullInput): Promise<Result> {
  const board = await requireBoard();
  if (!board) return { ok: false, error: 'Board only.' };
  const err = validateHull(input);
  if (err) return { ok: false, error: err };
  const admin = createAdminClient();
  const { error } = await admin.from('watercraft').insert({
    household_id: householdId,
    sticker_number: input.sticker,
    craft_type: input.craftType,
    is_checkinable: isCheckinableType(input.craftType),
    manufacturer: input.manufacturer?.trim() || null,
    model: input.model?.trim() || null,
    active: input.active,
  });
  if (error) {
    return {
      ok: false,
      error: /duplicate|unique/i.test(error.message)
        ? `Sticker #${input.sticker} is already assigned to another watercraft.`
        : error.message,
    };
  }
  revalidatePath('/admin');
  return { ok: true, message: 'Watercraft added.' };
}

export async function adminUpdateWatercraft(hullId: string, input: HullInput): Promise<Result> {
  const board = await requireBoard();
  if (!board) return { ok: false, error: 'Board only.' };
  const err = validateHull(input);
  if (err) return { ok: false, error: err };
  const admin = createAdminClient();
  const { error } = await admin
    .from('watercraft')
    .update({
      sticker_number: input.sticker,
      craft_type: input.craftType,
      is_checkinable: isCheckinableType(input.craftType), // keep in sync with type
      manufacturer: input.manufacturer?.trim() || null,
      model: input.model?.trim() || null,
      active: input.active,
    })
    .eq('id', hullId);
  if (error) {
    return {
      ok: false,
      error: /duplicate|unique/i.test(error.message)
        ? `Sticker #${input.sticker} is already assigned to another watercraft.`
        : error.message,
    };
  }
  revalidatePath('/admin');
  return { ok: true, message: 'Watercraft updated.' };
}

/** Move a hull to another household (hulls change hands). */
export async function adminTransferWatercraft(
  hullId: string,
  targetHouseholdId: string,
): Promise<Result> {
  const board = await requireBoard();
  if (!board) return { ok: false, error: 'Board only.' };
  const admin = createAdminClient();
  const { data: target } = await admin
    .from('households')
    .select('id, name')
    .eq('id', targetHouseholdId)
    .maybeSingle();
  if (!target) return { ok: false, error: 'Target household not found.' };
  const { error } = await admin
    .from('watercraft')
    .update({ household_id: targetHouseholdId })
    .eq('id', hullId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin');
  return { ok: true, message: `Transferred to ${target.name}.` };
}
