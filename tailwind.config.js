/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef9f6',
          100: '#d5f0e8',
          200: '#aee2d4',
          300: '#7ccdb8',
          400: '#4db097',
          500: '#0E8B6E',
          600: '#0b745c',
          700: '#095d4a',
          800: '#074738',
          900: '#053127'
        },
        gold: {
          50: '#fef9ec',
          100: '#fdf0cf',
          200: '#fbe09f',
          300: '#f8ca5f',
          400: '#F5A623',
          500: '#e08e0d',
          600: '#c06f09',
          700: '#9a510b',
          800: '#7d4110',
          900: '#673612'
        },
        surface: {
          50: '#F8FAFB',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        urdu: ['"Noto Nastaliq Urdu"', '"Jameel Noori Nastaleeq"', 'serif']
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'scan-line': 'scanLine 2s ease-in-out infinite'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        scanLine: {
          '0%, 100%': { transform: 'translateY(0%)' },
          '50%': { transform: 'translateY(90%)' }
        }
      }
    }
  },
  plugins: []
};
