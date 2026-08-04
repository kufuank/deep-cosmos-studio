/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#07090d',
        panel: '#0e1219',
        edge: '#1c2430',
      },
    },
  },
  plugins: [],
}
