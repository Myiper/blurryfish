/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ocean: {
          950: '#020710',
          900: '#040d1c',
          850: '#060f23',
          800: '#0a1428',
          700: '#0d1f3c',
          600: '#122850',
          500: '#163264',
        },
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4',
          glow: '#00e5ff',
        },
        teal: {
          400: '#2dd4bf',
          500: '#14b8a6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'ocean-gradient': 'linear-gradient(135deg, #020710 0%, #040d1c 40%, #060f23 100%)',
        'card-gradient': 'linear-gradient(135deg, rgba(6,15,35,0.8) 0%, rgba(13,31,60,0.6) 100%)',
        'glow-cyan': 'radial-gradient(circle, rgba(0,229,255,0.15) 0%, transparent 70%)',
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.5s ease-out forwards',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'shimmer': 'shimmer 2s infinite',
        'float': 'float 6s ease-in-out infinite',
        'bubble': 'bubble 4s ease-in infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        bubble: {
          '0%': { opacity: '0', transform: 'translateY(0) scale(0.8)' },
          '50%': { opacity: '0.6' },
          '100%': { opacity: '0', transform: 'translateY(-100px) scale(1.2)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'cyan-glow': '0 0 20px rgba(0,229,255,0.3), 0 0 60px rgba(0,229,255,0.1)',
        'cyan-glow-lg': '0 0 40px rgba(0,229,255,0.4), 0 0 80px rgba(0,229,255,0.15)',
        'card': '0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
      },
    },
  },
  plugins: [],
}
