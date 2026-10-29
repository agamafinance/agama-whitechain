import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Mounted at app.agama.finance/whitechain by a rewrite in the main app, the way /stellar-rwa and /xlayer are,
  // so this build serves its pages and its assets under the same prefix and nothing collides with the host's /_next.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '/whitechain',
  async redirects() {
    // The bare deployment URL lands on the app rather than on a 404.
    return [{ source: '/', destination: '/whitechain', basePath: false, permanent: false }];
  },
  // The ABIs live one level up, generated from the forge build and shared with the keeper.
  outputFileTracingRoot: root,
  turbopack: {
    root,
    // wagmi's optional connectors reach for these; none of them is used here.
    resolveAlias: { 'pino-pretty': './lib/empty.ts', lokijs: './lib/empty.ts', encoding: './lib/empty.ts' },
  },
};

export default nextConfig;
