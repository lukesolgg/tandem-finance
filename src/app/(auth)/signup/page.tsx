import Link from "next/link";
import { db } from "@/lib/db";
import { signupAllowed } from "@/domain/household/service";
import { signupAction } from "../actions";
import { NewPersonForm } from "../auth-form";

export const metadata = { title: "Set up" };

export default async function SignupPage() {
  if (!(await signupAllowed(db))) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Already set up</h1>
        <p className="mt-2 text-sm text-muted">This Tandem already has a household. Your partner can invite you from Settings → Household.</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-accent">Go to sign in</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Set up your household</h1>
      <p className="mb-6 mt-1 text-sm text-muted">You&apos;ll invite your partner next. You each get your own PIN and choose what the other can see.</p>
      <NewPersonForm action={signupAction} submit="Create household" askHousehold />
    </>
  );
}
