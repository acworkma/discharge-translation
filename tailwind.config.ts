import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0B5CAB',
          dark: '#083E73',
          light: '#3B82F6'
        }
      }
    }
  },
  plugins: []
};
export default config;
