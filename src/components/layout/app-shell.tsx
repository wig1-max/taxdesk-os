"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calculator,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  ScrollText,
  ShieldAlert,
  UserCheck,
  UserCircle,
  UserCog,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { ToastProvider } from "@/components/ui/toast";
import { APP_NAME, COMPANY_NAME, NAV_GROUPS, type NavItem } from "@/lib/constants";
import { useModalDialog } from "@/components/ui/use-modal-dialog";
import { cn } from "@/lib/utils";

const ICONS = {
  LayoutDashboard,
  Users,
  FolderOpen,
  Calculator,
  ScrollText,
  FileText,
  Wrench,
  UserCog,
  UserCheck,
  ShieldAlert,
} as const;

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavContent({
  pathname,
  role,
  onNavigate,
}: {
  pathname: string;
  role: "admin" | "staff";
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main navigation">
      {NAV_GROUPS.filter((g) => !g.adminOnly || role === "admin").map((group) => {
        const items = group.items.filter((i) => !i.adminOnly || role === "admin");
        if (items.length === 0) return null;
        return (
          <div key={group.label} className="space-y-1">
            <div className="px-3 text-[0.65rem] font-semibold uppercase tracking-wider text-shell-muted">
              {group.label}
            </div>
            {items.map((item) => {
              const Icon = ICONS[item.icon as keyof typeof ICONS] ?? FolderOpen;
              const active = isActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-[var(--motion-fast)]",
                    active
                      ? "bg-shell-active text-shell-active-foreground shadow-elev-1"
                      : "text-shell-foreground/80 hover:bg-shell-accent hover:text-shell-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function Identity({
  pathname,
  userName,
  role,
  onNavigate,
}: {
  pathname: string;
  userName: string;
  role: "admin" | "staff";
  onNavigate?: () => void;
}) {
  const accountActive = pathname === "/account";
  return (
    <div className="space-y-1 border-t border-shell-border p-3">
      <Link
        href="/account"
        onClick={onNavigate}
        aria-current={accountActive ? "page" : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
          accountActive
            ? "bg-shell-accent text-shell-foreground"
            : "text-shell-foreground/80 hover:bg-shell-accent hover:text-shell-foreground",
        )}
      >
        <UserCircle className="h-5 w-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{userName}</span>
          <span className="block text-xs capitalize text-shell-muted">{role}</span>
        </span>
      </Link>
      <form action={signOutAction}>
        <button
          type="submit"
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-shell-foreground/70 transition-colors hover:bg-shell-accent hover:text-shell-foreground"
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden />
          Sign out
        </button>
      </form>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex flex-col border-b border-shell-border px-5 py-4">
      <span className="text-lg font-bold tracking-tight text-shell-foreground">{APP_NAME}</span>
      <span className="text-xs text-shell-muted">{COMPANY_NAME}</span>
    </Link>
  );
}

export function AppShell({
  userName,
  role,
  children,
}: {
  userName: string;
  role: "admin" | "staff";
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Turn the mobile drawer into a real modal dialog: focus moves in on open,
  // Tab is trapped inside, Escape closes, and focus is restored to the trigger
  // on close. `restoreFocusRef` is explicit because the trigger lives inside the
  // content column, which becomes `inert` while the drawer is open (that blurs
  // it before `document.activeElement` can be captured as the fallback).
  const drawerRef = useModalDialog<HTMLElement>(mobileOpen, closeMobile, {
    restoreFocusRef: triggerRef,
  });

  // Close the mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // The drawer is visually hidden by Tailwind's `lg:hidden` breakpoint. If a
  // user rotates/resizes into desktop width while it is open, close it rather
  // than leaving an invisible focus trap, scroll lock, and inert background.
  useEffect(() => {
    if (!mobileOpen) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeAtDesktop = () => {
      if (desktop.matches) closeMobile();
    };
    closeAtDesktop();
    desktop.addEventListener("change", closeAtDesktop);
    return () => desktop.removeEventListener("change", closeAtDesktop);
  }, [mobileOpen, closeMobile]);

  return (
    <ToastProvider>
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Skip link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden h-full w-60 shrink-0 flex-col bg-shell text-shell-foreground lg:flex">
        <Brand />
        <NavContent pathname={pathname} role={role} />
        <Identity pathname={pathname} userName={userName} role={role} />
      </aside>

      {/* Mobile drawer — a true modal dialog (focus trapped, Escape closes,
          background inert, focus restored to the trigger on close). */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/50 animate-fade-in"
            onClick={closeMobile}
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            tabIndex={-1}
            className="absolute left-0 top-0 flex h-full w-64 flex-col bg-shell text-shell-foreground shadow-elev-3 animate-drawer-in focus:outline-none"
          >
            <Brand />
            <NavContent pathname={pathname} role={role} onNavigate={closeMobile} />
            <Identity
              pathname={pathname}
              userName={userName}
              role={role}
              onNavigate={closeMobile}
            />
          </aside>
        </div>
      )}

      {/* Content column — hidden from the a11y tree + non-focusable while the
          mobile drawer is open, so AT and Tab can't reach the page behind it. */}
      <div className="flex min-w-0 flex-1 flex-col" inert={mobileOpen || undefined}>
        {/* Mobile top bar */}
        <header className="flex items-center gap-3 border-b bg-elevated px-4 py-2.5 lg:hidden">
          <button
            ref={triggerRef}
            type="button"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            aria-haspopup="dialog"
            onClick={() => setMobileOpen(true)}
            className="-ml-1.5 inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground hover:bg-accent"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="font-bold tracking-tight">{APP_NAME}</span>
        </header>

        <main id="main-content" className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
    </ToastProvider>
  );
}
