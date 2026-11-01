import Link from "next/link";
import { db } from "@/lib/db";
import { findInvite } from "@/domain/household/service";
import { acceptInviteAction } from "../../actions";
import { NewPersonForm } from "../../auth-form";

export const metadata = { title: "Join" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findInvite(db, token);
  if (!invite) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">This invite has expired</h1>
        <p className="mt-2 text-sm text-muted">Invite links work once and last 7 days. Ask for a fresh one.</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-accent">Go to sign in</Link>
      </>
    );
  }
  const from = invite.invitedBy.name;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Join {invite.household.name}</h1>
      <p className="mb-6 mt-1 text-sm text-muted">{from} invited you. Your accounts stay yours — you decide what {from} can see.</p>
      <NewPersonForm action={acceptInviteAction} submit="Join household" hidden={{ token }} />
    </>
  );
}
