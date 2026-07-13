// Refresh the Supabase session on every request. This MUST follow the canonical
// @supabase/ssr shape exactly (Supabase docs): on refresh we (1) reflect the new
// cookies onto `request` so the server components rendered in THIS request read the
// fresh access token, (2) rebuild the response from the updated request, and (3)
// write the cookies to the response for the browser.
//
// Skipping step (1) is the bug that logs people out: the RSC downstream would still
// read the expired token and refresh again with the just-rotated refresh token,
// which trips Supabase's refresh-token reuse detection and REVOKES the whole session
// (→ "a new magic link every visit" once the ~1h access token expires).
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          // 1) reflect onto the request so downstream RSC read the FRESH tokens
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          // 2) rebuild the response from the updated request
          supabaseResponse = NextResponse.next({ request });
          // 3) write cookies to the response for the browser
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not run code between createServerClient and getUser — it refreshes the
  // session and, via setAll above, propagates the rotated token both ways.
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
