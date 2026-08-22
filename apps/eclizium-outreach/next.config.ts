import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /*
   * `standalone` empacota só o que a aplicação importa — é o que permite a
   * imagem Docker rodar enxuta.
   *
   * Fica atrás de uma variável porque `next start` NÃO funciona com essa saída:
   * ela exige `node .next/standalone/server.js`. Ligar por padrão quebraria
   * todo deploy que usa o comando normal, e o erro só apareceria em produção.
   */
  ...(process.env.BUILD_STANDALONE === 'true' ? { output: 'standalone' as const } : {}),
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
