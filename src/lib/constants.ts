export const APP_NAME = "TaxDesk OS";
export const COMPANY_NAME = "Demo Tax Practice";
export const COMPANY_CITY = "Gurugram, India";

/** Sidebar navigation. Settings/audit entries are admin-only (enforced in Phase D). */
export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/clients", label: "Clients", icon: "Users" },
  { href: "/cases", label: "Cases", icon: "FolderOpen" },
  { href: "/tax-desk", label: "Tax Desk", icon: "Calculator" },
  { href: "/audit-log", label: "Audit Log", icon: "ScrollText", adminOnly: true },
  { href: "/settings/templates", label: "Templates", icon: "FileText", adminOnly: true },
  { href: "/settings/services", label: "Services", icon: "Wrench", adminOnly: true },
  { href: "/settings/users", label: "Users", icon: "UserCog", adminOnly: true },
] as const;

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  /** Match by prefix (default) or exact path. */
  exact?: boolean;
}
export interface NavGroup {
  label: string;
  adminOnly?: boolean;
  items: NavItem[];
}

/**
 * Grouped navigation for the K.2.8.5 AppShell — organized around the user's
 * mental model, not a flat route dump. Every href is a real, existing route;
 * admin-only groups/items are hidden for staff.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Work",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", exact: true },
      { href: "/clients", label: "Clients", icon: "Users" },
      { href: "/cases", label: "Cases", icon: "FolderOpen" },
      { href: "/tax-desk", label: "Tax Desk", icon: "Calculator" },
    ],
  },
  {
    label: "Administration",
    adminOnly: true,
    items: [
      { href: "/audit-log", label: "Audit Log", icon: "ScrollText", adminOnly: true },
      { href: "/settings/templates", label: "Templates", icon: "FileText", adminOnly: true },
      { href: "/settings/services", label: "Services", icon: "Wrench", adminOnly: true },
      { href: "/settings/users", label: "Users", icon: "UserCog", adminOnly: true },
      { href: "/settings/reviewers", label: "Reviewers", icon: "UserCheck", adminOnly: true },
      { href: "/settings/purge", label: "Purge Queue", icon: "ShieldAlert", adminOnly: true },
    ],
  },
];

/** Tabs on the case detail screen. */
export const CASE_TABS = [
  { segment: "", label: "Overview" },
  { segment: "documents", label: "Documents" },
  { segment: "physical-documents", label: "Physical Docs" },
  { segment: "identity-review", label: "Identity Review" },
  { segment: "fees", label: "Fees" },
  { segment: "pdfs", label: "PDFs" },
  { segment: "messages", label: "Messages" },
] as const;

export const SERVICE_CODES = [
  "itr",
  "iepf",
  "gst",
  "business_reg",
  "mutual_fund",
  "insurance",
  "loan_dsa",
  "govt_forms",
] as const;
export type ServiceCode = (typeof SERVICE_CODES)[number];

/** Upload constraints — mirrored by Zod schemas and (later) DB CHECKs. */
export const UPLOAD_MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
export const UPLOAD_ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;
export const UPLOAD_LINK_DEFAULT_HOURS = 72;
export const UPLOAD_LINK_MAX_HOURS = 168; // 7 days
export const UPLOAD_LINK_DEFAULT_MAX_UPLOADS = 10;
export const UPLOAD_LINK_MAX_UPLOADS = 25;

/** IEPF fee defaults (admin-overridable per case, always audited). */
export const IEPF_FEE_PERCENT_DEFAULT = 15;
export const IEPF_UPFRONT_FEE_DEFAULT = 5000;

export const DISCLAIMER_TEXT =
  "Final filing/submission is subject to verification and client approval. " +
  "Demo Tax Practice does not provide investment advice.";
