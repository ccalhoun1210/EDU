import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: 'identity', include: ['src/**/*.test.ts'] } });
