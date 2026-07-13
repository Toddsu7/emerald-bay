/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Supabase Storage serves hull photos; allow the project's storage host.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'heybszfdbvavedjkgggb.supabase.co' },
    ],
  },
  // Aggressively cache the static lake aerials (stable filenames, rarely change).
  async headers() {
    return [
      {
        source: '/lakes/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=604800, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
