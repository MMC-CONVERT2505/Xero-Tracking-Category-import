/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // One accent (indigo) reserved for primary actions / active state.
        brand: {
          50: '#EEF2FF',
          100: '#E0E7FF',
          400: '#818CF8',
          500: '#6366F1',
          600: '#4F46E5',
          700: '#4338CA',
          800: '#3730A3',
        },
        canvas: '#F6F7FB',
        ink: {
          900: '#0F172A',
          700: '#334155',
          500: '#64748B',
          400: '#94A3B8',
        },
        line: '#E4E7EF',
        success: { 50: '#ECFDF5', 600: '#059669', 700: '#047857' },
        warning: { 50: '#FFFBEB', 600: '#D97706', 700: '#B45309' },
        danger: { 50: '#FEF2F2', 600: '#DC2626', 700: '#B91C1C' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'fade-rise': { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        'fade-in': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        'scale-in': { '0%': { opacity: 0, transform: 'scale(0.96)' }, '100%': { opacity: 1, transform: 'scale(1)' } },
        'slide-in-right': { '0%': { opacity: 0, transform: 'translateX(12px)' }, '100%': { opacity: 1, transform: 'translateX(0)' } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
      },
      animation: {
        'fade-rise': 'fade-rise 0.5s ease-out both',
        'fade-in': 'fade-in 0.2s ease-out both',
        'scale-in': 'scale-in 0.15s ease-out both',
        'slide-in-right': 'slide-in-right 0.25s ease-out both',
        shimmer: 'shimmer 1.6s infinite linear',
      },
    },
  },
  plugins: [],
};
