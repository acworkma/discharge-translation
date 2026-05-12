/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: '25mb' } }
};
export default nextConfig;
