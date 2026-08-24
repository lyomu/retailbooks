import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  output: 'standalone',
  transpilePackages: ['@retailbooks/contracts', '@retailbooks/ui'],
};

export default nextConfig;
