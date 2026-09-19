import type { Metadata } from "next";
import { signInAction } from "@/app/actions/auth";
import { ForgotPassword } from "@/components/forgot-password";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_NAME, COMPANY_NAME } from "@/lib/constants";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  missing: "Please enter email and password.",
  invalid: "Invalid email or password.",
  inactive: "This account is inactive. Contact the administrator.",
  session: "Please sign in to continue.",
  server: "Sign-in failed because of a server problem. Check the server logs or contact the administrator.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl text-primary">{APP_NAME}</CardTitle>
          <CardDescription>{COMPANY_NAME} — staff sign in</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {ERRORS[error] ?? "Sign-in failed."}
            </p>
          )}
          <form className="space-y-4" action={signInAction}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button className="w-full" type="submit">
              Sign in
            </Button>
          </form>
          <ForgotPassword />
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Access is invite-only. Contact the administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
