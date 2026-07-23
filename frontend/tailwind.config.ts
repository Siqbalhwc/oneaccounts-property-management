import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1F2D24",
        ledger: {
          DEFAULT: "#2F4F3D",
          dark: "#22392C",
          light: "#3D6650",
        },
        paper: {
          DEFAULT: "#F3F1E6",
          card: "#FBFAF5",
        },
        brass: {
          DEFAULT: "#C89B5C",
          dark: "#A67C3D",
          light: "#DDBB86",
        },
        rule: "#8B3A3A",
        stamp: {
          green: "#2F4F3D",
          red: "#A63D40",
          amber: "#B8862E",
          slate: "#565F5A",
        },
        border: {
          DEFAULT: "#DCD7C4",
        },
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        body: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "6px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(31,45,36,0.06), 0 1px 0 rgba(31,45,36,0.04)",
      },
    },
  },
  plugins: [],
};
export default config;
