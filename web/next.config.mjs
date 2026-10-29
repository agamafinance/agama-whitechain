import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The ABIs live one level up, generated from the forge build and shared with the keeper.
  outputFileTracingRoot: root,
  turbopack: {
    root,
    // wagmi's optional connectors reach for these; none of them is used here.
    resolveAlias: { 'pino-pretty': './lib/empty.ts', lokijs: './lib/empty.ts', encoding: './lib/empty.ts' },
  },
};

export default nextConfig;
