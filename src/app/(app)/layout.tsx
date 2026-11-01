import { LogOut } from "lucide-react";
import { requireViewerContext } from "@/lib/session";
import { MobileNav, Sidebar } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Shortcuts } from "@/components/shortcuts";
import { Avatar } from "@/components/ui";
import { logoutAction } from "../(auth)/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireViewerContext();
  const footer = (
    <div className="space-y-1 border-t border-border pt-3">
      <ThemeToggle />
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Avatar name={ctx.user.name} colour={ctx.user.colour} />
        <span className="flex-1 truncate text-sm">{ctx.user.name}</span>
        {ctx.partner && <Avatar name={ctx.partner.name} colour={ctx.partner.colour} />}
        <form action={logoutAction}>
          <button className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Sign out" title="Sign out">
            <LogOut size={15} />
          </button>
        </form>
      </div>
    </div>
  );
  return (
    <div className="flex min-h-dvh">
      <Sidebar footer={footer} />
      <main className="min-w-0 flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
      <MobileNav footer={footer} />
      <Shortcuts />
    </div>
  );
}
