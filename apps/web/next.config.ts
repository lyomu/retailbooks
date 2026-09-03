import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  output: 'standalone',
  transpilePackages: ['@retailbooks/contracts', '@retailbooks/localization', '@retailbooks/ui'],
  experimental: {
    cpus: 1,
    staticGenerationMaxConcurrency: 1,
  },
};

export default nextConfig;
