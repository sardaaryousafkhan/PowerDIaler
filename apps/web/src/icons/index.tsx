import type { ReactElement, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(props: IconProps, children: ReactElement | ReactElement[]): ReactElement {
  const { size = 20, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconDashboard(p: IconProps): ReactElement {
  return base(p, <>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </>);
}
export function IconCampaigns(p: IconProps): ReactElement {
  return base(p, <>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </>);
}
export function IconPlus(p: IconProps): ReactElement {
  return base(p, <path d="M12 5v14M5 12h14" />);
}
export function IconIntegrations(p: IconProps): ReactElement {
  return base(p, <>
    <circle cx="8" cy="8" r="2.5" />
    <circle cx="16" cy="8" r="2.5" />
    <circle cx="12" cy="16" r="2.5" />
    <path d="M10 9.5 11 13.5M14 9.5 13 13.5" />
  </>);
}
export function IconCrm(p: IconProps): ReactElement {
  return base(p, <>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 19c1.5-3 4-4.5 7-4.5s5.5 1.5 7 4.5" />
  </>);
}
export function IconDnc(p: IconProps): ReactElement {
  return base(p, <>
    <circle cx="12" cy="12" r="8" />
    <path d="M7 7l10 10" />
  </>);
}
export function IconSettings(p: IconProps): ReactElement {
  return base(p, <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
  </>);
}
export function IconMembers(p: IconProps): ReactElement {
  return base(p, <>
    <circle cx="9" cy="9" r="3" />
    <circle cx="16" cy="10" r="2.5" />
    <path d="M3 19c1-3 3.5-4.5 6-4.5S14 16 15 19M14 19c.5-2 2-3 4-3s2.5.8 3 2.5" />
  </>);
}
export function IconBilling(p: IconProps): ReactElement {
  return base(p, <>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M3 10h18" />
  </>);
}
export function IconLicense(p: IconProps): ReactElement {
  return base(p, <>
    <rect x="5" y="3" width="14" height="18" rx="1.5" />
    <path d="M9 8h6M9 12h6M9 16h4" />
  </>);
}
export function IconPortal(p: IconProps): ReactElement {
  return base(p, <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M4 10h16" />
  </>);
}
export function IconSearch(p: IconProps): ReactElement {
  return base(p, <>
    <circle cx="11" cy="11" r="6" />
    <path d="M16 16l4 4" />
  </>);
}
export function IconMute(p: IconProps): ReactElement {
  return base(p, <>
    <path d="M9 9v6h3l4 3V6l-4 3H9Z" />
    <path d="M4 4l16 16" />
  </>);
}
export function IconHold(p: IconProps): ReactElement {
  return base(p, <>
    <path d="M8 5v14M16 5v14" />
  </>);
}
export function IconTransfer(p: IconProps): ReactElement {
  return base(p, <>
    <path d="M7 7h10M14 4l3 3-3 3M17 17H7M10 14l-3 3 3 3" />
  </>);
}
export function IconKeypad(p: IconProps): ReactElement {
  return base(p, <>
    <circle cx="8" cy="7" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="7" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="16" cy="7" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="8" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="16" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="8" cy="17" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="17" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="16" cy="17" r="1.2" fill="currentColor" stroke="none" />
  </>);
}
export function IconHangup(p: IconProps): ReactElement {
  return base(p, <>
    <path d="M6 15c2-4 10-4 12 0l-2 2c-1-.5-2-.8-4-.8s-3 .3-4 .8L6 15Z" />
  </>);
}
export function IconPhone(p: IconProps): ReactElement {
  return base(p, <>
    <path d="M8 5h3l1 4-2 1c1 2 2.5 3.5 4.5 4.5l1-2 4 1v3c0 1-1 2-2.5 2C10 19 5 14 5 7.5 5 6 6 5 8 5Z" />
  </>);
}
export function IconLogout(p: IconProps): ReactElement {
  return base(p, <>
    <path d="M10 5H6v14h4M14 16l4-4-4-4M9 12h9" />
  </>);
}
export function IconTheme(p: IconProps): ReactElement {
  return base(p, <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4v16" />
    <path d="M12 4a8 8 0 0 1 0 16" fill="currentColor" stroke="none" opacity="0.35" />
  </>);
}
export function IconCheck(p: IconProps): ReactElement {
  return base(p, <path d="M5 12l5 5L20 7" />);
}
export function IconAlert(p: IconProps): ReactElement {
  return base(p, <>
    <path d="M12 4 3 19h18L12 4Z" />
    <path d="M12 10v4M12 16.5v.5" />
  </>);
}
export function IconX(p: IconProps): ReactElement {
  return base(p, <path d="M6 6l12 12M18 6 6 18" />);
}
export function IconInfo(p: IconProps): ReactElement {
  return base(p, <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 11v5M12 8v.5" />
  </>);
}
export function IconArrowUp(p: IconProps): ReactElement {
  return base(p, <path d="M12 19V5M6 11l6-6 6 6" />);
}
export function IconArrowDown(p: IconProps): ReactElement {
  return base(p, <path d="M12 5v14M6 13l6 6 6-6" />);
}
export function IconBell(p: IconProps): ReactElement {
  return base(p, <>
    <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </>);
}
export function IconHelp(p: IconProps): ReactElement {
  return base(p, <>
    <circle cx="12" cy="12" r="8" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8V14" />
    <path d="M12 17v.5" />
  </>);
}
