/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output bundles a minimal node_modules tree next to server.js.
  // Required for our docker runtime stage.
  output: 'standalone',
  // Trace files outside apps/web (workspace deps) into the standalone output.
  // Without this, pnpm symlinks to ../../packages/* aren't followed and we get
  // "Module not found: @link-checker/shared" at runtime.
  outputFileTracingRoot: require('path').join(__dirname, '../../'),
  // Transpile workspace packages so Next bundles their TS source directly
  // instead of trying to require pre-built dist/ files (which may or may not
  // exist depending on the build order in docker).
  transpilePackages: ['@link-checker/shared'],
  experimental: {
    typedRoutes: true,
  },
};

module.exports = nextConfig;
