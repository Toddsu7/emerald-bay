/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Supabase Storage serves hull photos; allow the project's storage host.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'heybszfdbvavedjkgggb.supabase.co' },
    ],
  },
};

export default nextConfig;
