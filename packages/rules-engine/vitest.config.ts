import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: 'rules-engine', include: ['src/**/*.test.ts'] } });
