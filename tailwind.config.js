/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Semantic design tokens — single source of truth via CSS variables.
        // RGB-channel format enables Tailwind's opacity modifier: bg-t-bg/50
        "t-bg":     "rgb(var(--t-bg)    / <alpha-value>)",
        "t-panel":  "rgb(var(--t-panel) / <alpha-value>)",
        "t-card":   "rgb(var(--t-card)  / <alpha-value>)",
        "t-field":  "rgb(var(--t-field) / <alpha-value>)",
        "t-hover":  "rgb(var(--t-hover) / <alpha-value>)",
        "t-active": "rgb(var(--t-active)/ <alpha-value>)",
        "t-line":   "rgb(var(--t-line)  / <alpha-value>)",
        "t-line2":  "rgb(var(--t-line2) / <alpha-value>)",
        "t-ink":    "rgb(var(--t-ink)   / <alpha-value>)",
        "t-ink2":   "rgb(var(--t-ink2)  / <alpha-value>)",
        "t-ink3":   "rgb(var(--t-ink3)  / <alpha-value>)",
        "t-ink4":   "rgb(var(--t-ink4)  / <alpha-value>)",
        "t-ink5":   "rgb(var(--t-ink5)  / <alpha-value>)",
        // Selection / matching-bracket tint — also used by autocomplete
        // popups so non-CodeMirror inputs can match the editor's look.
        "t-selection": "rgb(var(--t-selection) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
