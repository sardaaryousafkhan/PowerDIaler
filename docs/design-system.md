# DashDialer design system — Obsidian & Rosé

Precision-instrument UI for long call sessions. Dark (Obsidian) is default; light (Porcelain) is equal.

## Tokens

Source of truth: [`apps/web/src/design/tokens.css`](../apps/web/src/design/tokens.css)  
Typed mirror: [`apps/web/src/design/theme.ts`](../apps/web/src/design/theme.ts)  
Motion budget: [`apps/web/src/design/motion.ts`](../apps/web/src/design/motion.ts)

- Canvas `#0A0A0C` / surfaces `#101014`–`#1B1B22`
- Text warm off-white `#F4F2EF`
- Brand accent Rosé Alloy `#E08E96` → `#C9737F` (≤8% of viewport at rest)
- Semantic: live `#5FE3A1`, warn `#F2B45C`, danger `#F05F6A`, info `#7FB2F0`
- Radii only: 6 / 10 / 14 / 20 / 999
- Type: Geist 400/500/600, Geist Mono (tabular), Instrument Serif (empty states only)

## Logo

- Mark: geometric power-arc (`AppLogo`, `public/logo.svg`)
- Mono: `public/brand/logo-mono.svg`
- App icon: `public/brand/app-icon.svg`
- Clear space = mark height; min mark 16px

## Motion

| Token | ms |
| --- | --- |
| input | 90 |
| hover/focus | 140 |
| standard | 200 |
| overlay | 320 |
| deliberate | 480 |

Easings: standard `cubic-bezier(0.2,0.8,0.2,1)`, enter `cubic-bezier(0.16,1,0.3,1)`, exit `cubic-bezier(0.4,0,1,1)`.  
Spring: stiffness 320, damping 32. Max 2 animated properties. `prefers-reduced-motion` → 120ms opacity only.

## Shell

64px icon rail (expands to 240px on hover) · 56px command bar · ⌘K palette · content max 1600px.

## Accessibility

WCAG 2.2 AA target on token pairs. Focus: 2px rose ring, 2px offset. Hit targets ≥32px (44px preferred).
