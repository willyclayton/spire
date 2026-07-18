/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: '#141B2D',
        amber: '#F5A623',
        soft: '#F4F6FB',
        steel: '#8A93A6',
        danger: '#E4572E',
        // Time Machine accent — a warmer, aged temperature than Spire's amber.
        sepia: '#C9A227',
        'sepia-deep': '#8A6E1C',
      },
      fontFamily: {
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
