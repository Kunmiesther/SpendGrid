/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      colors: {
        surface: {
          0: "#080808",
          1: "#0f0f0f",
          2: "#141414",
          3: "#1a1a1a",
          4: "#222222",
          5: "#2a2a2a",
        },
        ink: {
          0: "#f5f5f5",
          1: "#c8c8c8",
          2: "#8a8a8a",
          3: "#555555",
          4: "#333333",
        },
        signal: "#e2e2e2",
        wire: "#1f1f1f",
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      fontSize: {
        "display-xl": ["clamp(3rem,6vw,5.5rem)", { lineHeight: "1.0", letterSpacing: "-0.03em" }],
        "display-lg": ["clamp(2rem,4vw,3.5rem)", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
        "display-md": ["clamp(1.5rem,3vw,2.25rem)", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        "body-lg": ["1.125rem", { lineHeight: "1.7" }],
        "body-md": ["1rem", { lineHeight: "1.65" }],
        "body-sm": ["0.875rem", { lineHeight: "1.6" }],
        "label": ["0.6875rem", { lineHeight: "1", letterSpacing: "0.1em" }],
        "mono-sm": ["0.8125rem", { lineHeight: "1.5" }],
      },
      spacing: {
        section: "8rem",
        "section-sm": "5rem",
      },
      borderColor: {
        DEFAULT: "#1f1f1f",
      },
      maxWidth: {
        "content": "1200px",
      },
    },
  },
  plugins: [],
};
