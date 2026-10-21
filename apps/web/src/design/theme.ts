/** Typed mirror of Obsidian & Rosé CSS tokens. */

export const colors = {
  canvas: "#0A0A0C",
  surface1: "#101014",
  surface2: "#15151A",
  surface3: "#1B1B22",
  surfaceHover: "#202028",
  textHi: "#F4F2EF",
  textMid: "#A6A3A0",
  textLow: "#6E6B69",
  textInverse: "#0A0A0C",
  rose100: "#FBE8E6",
  rose300: "#F0BFC0",
  rose500: "#E08E96",
  rose600: "#C9737F",
  live: "#5FE3A1",
  warn: "#F2B45C",
  danger: "#F05F6A",
  info: "#7FB2F0",
  idle: "#6E6B69",
} as const;

export const lightColors = {
  canvas: "#F7F5F2",
  surface1: "#FFFFFF",
  surface2: "#F1EEE9",
  textHi: "#14110F",
  textMid: "#5C5854",
  rose500: "#C9737F",
} as const;

export const radii = {
  chip: 6,
  button: 10,
  card: 14,
  modal: 20,
  pill: 999,
} as const;

export const typeScale = {
  display: { size: 40, line: 44, tracking: "-0.024em", weight: 500 },
  h1: { size: 30, line: 36, tracking: "-0.020em", weight: 600 },
  h2: { size: 22, line: 28, tracking: "-0.016em", weight: 600 },
  h3: { size: 17, line: 24, tracking: "-0.010em", weight: 600 },
  body: { size: 15, line: 22, tracking: "-0.006em", weight: 400 },
  bodySm: { size: 13, line: 19, tracking: "0", weight: 400 },
  caption: { size: 12, line: 16, tracking: "0.005em", weight: 500 },
  micro: { size: 11, line: 14, tracking: "0.08em", weight: 600 },
  timer: { size: 56, line: 56, tracking: "-0.02em", weight: 500 },
  statLg: { size: 34, line: 38, tracking: "-0.02em", weight: 500 },
} as const;

export const space = [4, 8, 12, 16, 24, 32, 48, 64] as const;
