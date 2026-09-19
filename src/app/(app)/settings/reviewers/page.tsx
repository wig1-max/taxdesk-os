import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page";
import { ReviewerCredentialsAdmin } from "@/components/reviewer-credentials-admin";
import { requireAdmin } from "@/lib/auth";
import { getReviewerCredentialsAdmin } from "@/lib/queries/tax-reviewer";

export const metadata: Metadata = { title: "Reviewers" };

export default async function ReviewerCredentialsSettingsPage() {
  await requireAdmin();
  const { credentials, users } = await getReviewerCredentialsAdmin();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Qualified reviewers (admin)"
        description="Grant, manage, and revoke qualified-reviewer status for the manual professional review sign-off."
        help="A qualified reviewer can record a sign-off on a Tax Desk case that the K.2.8.9A eligibility gate routed to manual professional review. Only active reviewers can sign off, and a reviewer can never sign off on a case they prepared. The registration/membership reference is credential-sensitive: it is visible to admins only and is never shown to ordinary staff. Revoking a credential removes the ability to sign off but preserves the immutable history of past sign-offs. Every change is written to the audit log."
      />
      <ReviewerCredentialsAdmin credentials={credentials} users={users} />
    </div>
  );
}
