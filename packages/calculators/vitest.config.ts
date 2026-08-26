import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: 'calculators', include: ['src/**/*.test.ts'] } });
