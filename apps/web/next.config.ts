import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@retailbooks/contracts', '@retailbooks/ui'],
};

export default nextConfig;
