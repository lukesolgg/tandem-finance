import { redirect } from "next/navigation";
// The dashboard doubles as the onboarding checklist until the first import.
export default function Onboarding() {
  redirect("/");
}
