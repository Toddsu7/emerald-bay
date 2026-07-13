// Resolve the signed-in member from the Supabase session. On first login we claim
// the member row whose email matches the auth user (the invite model, §7).
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export interface CurrentMember {
  id: string;
  householdId: string;
  householdName: string;
  isAdmin: boolean;
  firstName: string;
  lastName: string;
  email: string | null;
  mobile: string | null;
}

export async function getCurrentMember(): Promise<CurrentMember | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();

  let { data: member } = await admin
    .from('members')
    .select('*, households(name)')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  // First login: match an unclaimed member by email and link it to this auth user.
  if (!member && user.email) {
    const { data: byEmail } = await admin
      .from('members')
      .select('*, households(name)')
      .ilike('email', user.email)
      .is('auth_user_id', null)
      .maybeSingle();
    if (byEmail) {
      await admin.from('members').update({ auth_user_id: user.id }).eq('id', byEmail.id);
      member = byEmail;
    }
  }

  if (!member) return null;
  const household = (member as { households?: { name?: string } }).households;
  return {
    id: member.id,
    householdId: member.household_id,
    householdName: household?.name ?? '',
    isAdmin: member.is_admin,
    firstName: member.first_name,
    lastName: member.last_name,
    email: member.email,
    mobile: member.mobile,
  };
}
