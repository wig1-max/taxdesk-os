"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CASE_TABS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function CaseTabs({ caseId, serviceCode }: { caseId: string; serviceCode: string }) {
  const pathname = usePathname();
  const base = `/cases/${caseId}`;

  // Identity Review is an IEPF-only step; hide the tab for other services.
  const tabs = CASE_TABS.filter(
    (tab) => tab.segment !== "identity-review" || serviceCode === "iepf"
  );

  return (
    <nav
      className="flex flex-wrap gap-1 border-b pb-px"
      aria-label="Case sections"
    >
      {tabs.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const active = pathname === href;
        return (
          <Link
            key={tab.label}
            href={href}
            className={cn(
              "rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
