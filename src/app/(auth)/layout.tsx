// Every auth page reads the DB (sign-up open? invite valid?) — never prerender.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={32} height={32} />
          <span className="text-lg font-semibold tracking-tight">Tandem</span>
        </div>
        {children}
      </div>
    </main>
  );
}
