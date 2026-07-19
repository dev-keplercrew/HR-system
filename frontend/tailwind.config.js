/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0F2A3F",
          soft: "#1E3A50",
          muted: "#5B7183",
        },
        canvas: "#F5F7F8",
        surface: "#FFFFFF",
        line: "#E2E8EA",
        teal: {
          DEFAULT: "#0E7C7B",
          dark: "#0A5F5E",
          soft: "#E6F2F1",
        },
        amber: {
          DEFAULT: "#E8A317",
          soft: "#FCF3E0",
        },
        good: "#1B873F",
        warn: "#B7791F",
        bad: "#C2410C",
      },
      fontFamily: {
        display: ["Sora", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 42, 63, 0.04), 0 1px 3px rgba(15, 42, 63, 0.06)",
        pop: "0 8px 24px rgba(15, 42, 63, 0.12)",
      },
      borderRadius: {
        xl: "0.75rem",
      },
    },
  },
  plugins: [],
};
