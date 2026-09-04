/**
 * A small, purpose-drawn icon set for the sidebar nav -- ledger book,
 * stamped sheet, keys, coins -- instead of pulling generic icon-pack
 * glyphs for concepts (accounting, ownership) that don't have an obvious
 * one-to-one match in most packs. Every icon shares the same stroke
 * width/line-cap/line-join so they read as one family.
 *
 * Usage: <IconBuildings size={16} className="opacity-80" />
 */
type IconProps = { size?: number; className?: string };

function Icon({ size = 16, className = "", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export function IconDashboard(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="3.5" width="7.5" height="4.5" rx="1.5" />
      <rect x="13" y="10" width="7.5" height="10.5" rx="1.5" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" />
    </Icon>
  );
}

export function IconProperty(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 21V6.5L12 3l8 3.5V21" />
      <path d="M9 21v-6h6v6" />
      <path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01" />
    </Icon>
  );
}

export function IconOwners(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20v-5a4 4 0 0 1 4-4h1M15 20v-5a4 4 0 0 0-4-4h-1" />
      <circle cx="8.5" cy="7.5" r="3" />
      <circle cx="16" cy="9" r="2.3" />
    </Icon>
  );
}

export function IconTenants(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="3.3" />
      <path d="M5.5 20.5c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2" />
    </Icon>
  );
}

export function IconLeases(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="14.5" r="4" />
      <path d="M11 12l8.5-8.5M17 5l2 2M14 8l2 2" />
    </Icon>
  );
}

export function IconMoney(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="6" width="19" height="13" rx="2.2" />
      <path d="M2.5 10h19" />
      <circle cx="7" cy="14.3" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconInvoices(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3.5h9l3.5 3.5V20.5H6z" />
      <path d="M9 11h6M9 14.3h6M9 17.6h4" />
    </Icon>
  );
}

export function IconExpenses(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.5h16v11H4z" />
      <path d="M4 10.2c2 0 3-1 3-3M20 10.2c-2 0-3-1-3-3M4 14.3c2 0 3 1 3 3M20 14.3c-2 0-3 1-3 3" />
      <circle cx="12" cy="12" r="2.1" />
    </Icon>
  );
}

export function IconStaff(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="7.3" r="3.3" />
      <path d="M5.5 20.5c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2" />
    </Icon>
  );
}

export function IconAccounting(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 4.5h16M4 4.5v13.2a2.3 2.3 0 0 0 2.3 2.3M20 4.5v13.2a2.3 2.3 0 0 1-2.3 2.3H6.3M8 9h4M8 12.3h4" />
    </Icon>
  );
}

export function IconJournal(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3.5h9l3.5 3.5V20.5H6z" />
      <path d="M9 11h6M9 14.3h6M9 17.6h6" />
    </Icon>
  );
}

export function IconScale(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v3M6 8.5l-3 6a3 3 0 0 0 6 0l-3-6ZM18 8.5l-3 6a3 3 0 0 0 6 0l-3-6ZM3.5 8.5h17M12 6l-6 2.5M12 6l6 2.5M8 20.5h8" />
    </Icon>
  );
}

export function IconTrend(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 19V6M4 19h16M8 19v-6.5M12.5 19V9M17 19v-9.5" />
    </Icon>
  );
}

export function IconBalanceSheet(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4" width="17" height="16" rx="1.8" />
      <path d="M12 4v16M3.5 12h17" />
    </Icon>
  );
}

export function IconReports(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 19.5V4.5h11l5 5v10z" />
      <path d="M15 4.5V9h5M8 13.5h8M8 16.7h5.5" />
    </Icon>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="2.6" />
      <path d="M19.4 13.5a1.7 1.7 0 0 0 .35 1.9l.06.06a2 2 0 1 1-2.9 2.8l-.07-.06a1.7 1.7 0 0 0-1.9-.34 1.7 1.7 0 0 0-1 1.55V19.6a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.9.34l-.06.06a2 2 0 1 1-2.9-2.8l.06-.06a1.7 1.7 0 0 0 .35-1.9 1.7 1.7 0 0 0-1.55-1H4.4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.35-1.9l-.06-.06a2 2 0 1 1 2.9-2.8l.06.06a1.7 1.7 0 0 0 1.9.35H10.5a1.7 1.7 0 0 0 1-1.55V4.4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.9-.35l.06-.06a2 2 0 1 1 2.9 2.8l-.06.06a1.7 1.7 0 0 0-.34 1.9v.1a1.7 1.7 0 0 0 1.54 1h.15a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.55 1Z" />
    </Icon>
  );
}

export function IconTower(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 21V9l3-4 3 4v12" />
      <path d="M6 21V13l3-2M18 21V13l-3-2" />
      <path d="M9 21h6" />
    </Icon>
  );
}

export function IconImplementation(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 21V4.5" />
      <path d="M5 5l12 2.5L5 10" />
    </Icon>
  );
}

export function IconChevron(props: IconProps) {
  return (
    <Icon {...props} className={`${props.className ?? ""}`}>
      <path d="M6 9l6 6 6-6" strokeWidth={2} />
    </Icon>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.35-4.35" />
    </Icon>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 16.2V11a6 6 0 0 0-4.4-5.8V4a1.6 1.6 0 1 0-3.2 0v1.2A6 6 0 0 0 6 11v5.2L4.3 18.5h15.4L18 16.2Z" />
      <path d="M9.5 20.5a2.5 2.5 0 0 0 5 0" />
    </Icon>
  );
}

export function IconArrowUpRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 17L17 7M9 7h8v8" strokeWidth={2} />
    </Icon>
  );
}
