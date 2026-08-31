import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GitHubButton, SignInForm } from "./signin-form";

export const metadata = { title: "Anmelden" };

export default async function SignInPage() {
  if (await currentUserId()) redirect("/");

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Anmelden</CardTitle>
          <CardDescription>
            Zwei Wege: GitHub für echte Konten, oder eines der beiden Demo-Konten.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <GitHubButton />
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-widest text-muted-foreground">oder</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <SignInForm />
        </CardContent>
      </Card>
    </main>
  );
}
