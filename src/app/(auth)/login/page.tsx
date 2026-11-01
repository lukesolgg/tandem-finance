import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/session";
import { loginPeople, signupAllowed } from "@/domain/household/service";
import { loginAction } from "../actions";
import { LoginForm } from "../auth-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getViewer()) redirect("/");
  if (await signupAllowed(db)) redirect("/signup");
  const { next } = await searchParams;
  const people = await loginPeople(db);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Who&apos;s this?</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Tap your name and enter your PIN.</p>
      <LoginForm action={loginAction} people={people} next={next} />
      {people.length === 1 && (
        <p className="mt-6 text-center text-xs text-muted">
          Joining your partner? Open the invite link they sent you.
        </p>
      )}
    </>
  );
}
