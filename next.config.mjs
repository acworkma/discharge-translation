/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: '25mb' } },
  serverExternalPackages: ['pdfkit', 'pdf-parse', 'mammoth'],
  // pdfkit ships built-in AFM/PFB font files that Next's tracing misses.
  outputFileTracingIncludes: {
    '/api/**/*': [
      './node_modules/pdfkit/js/data/**/*',
      './node_modules/pdf-parse/dist/**/*'
    ]
  }
};
export default nextConfig;
