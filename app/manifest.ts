import type { MetadataRoute } from 'next';

// PWA manifest — homescreen install, not the app stores (§11).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Emerald Bay Lake App',
    short_name: 'Emerald Bay',
    description: 'Check-in and access gating for the Emerald Bay lakes.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#059669',
    icons: [
      // TODO(handoff): add real 192/512 PNG icons under /public and reference here.
    ],
  };
}
