import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Empacota só o que a aplicação importa de fato — é o que permite a imagem
  // Docker rodar sem carregar node_modules inteiro.
  output: 'standalone',
  typedRoutes: false,
  eslint: {
    // Linting runs as its own pipeline step (`npm run lint`); keeping it out of
    // `next build` makes build failures unambiguous.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Server Actions receive user input; keep the payload ceiling tight.
    serverActions: { bodySizeLimit: '2mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
