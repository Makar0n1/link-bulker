import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    // SWC compiles TS with decorator metadata, which NestJS DI requires.
    // Vitest's default esbuild does NOT emit decorator metadata, so without
    // this plugin every Nest controller crashes on dependency resolution.
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        target: 'es2022',
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    sequence: { concurrent: false },
  },
});
