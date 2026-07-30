import { defineConfig } from 'vite';

export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['tests/js/**/*.test.js'],
        globals: false,
        restoreMocks: true,
    },
});
