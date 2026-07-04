// Meridian pricing page — Tailwind JSX with intentional token drift
export function PricingPage() {
  return (
    <div className="min-h-screen bg-[#f7f8fa] text-[#1a1a2e]">
      <header className="border-b border-[#e4e7ec] bg-white px-8 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="h-8 w-8 rounded-lg bg-[#ff6b35]" />
            <span className="text-lg font-bold tracking-tight">Meridian</span>
          </div>
          <nav className="flex gap-6 text-sm text-[#5b6472]">
            <a href="#features">Features</a>
            <a href="#pricing" className="font-semibold text-[#1a1a2e]">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-8 py-16">
        <div className="mb-12 text-center">
          <p className="mb-3 text-[13px] font-semibold uppercase tracking-widest text-[#ff7038]">
            Simple, transparent pricing
          </p>
          <h1 className="mb-4 text-[30px] font-bold tracking-tight">Plans that scale with your system</h1>
          <p className="mx-auto max-w-xl text-[17px] leading-relaxed text-[#5b6472]">
            Every plan includes drift scanning, live preview, and agent hooks. Upgrade when your team grows.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <article className="rounded-lg border border-[#e4e7ec] bg-white p-[15px] shadow-sm">
            <h2 className="text-base font-semibold">Starter</h2>
            <p className="mt-1 text-sm text-[#5b6472]">For solo designers</p>
            <p className="mt-6 text-[32px] font-bold">$0</p>
            <p className="text-sm text-[#5b6472]">forever free</p>
            <ul className="mt-6 space-y-3 text-sm text-[#5b6472]">
              <li>3 pages · weekly scan</li>
              <li>Intrinsic token baseline</li>
              <li>CLI + web dashboard</li>
            </ul>
            <button type="button" className="mt-8 w-full rounded-lg bg-[#f7f8fa] py-3 text-sm font-semibold text-[#1a1a2e] ring-1 ring-[#e4e7ec]">
              Get started
            </button>
          </article>

          <article className="relative rounded-lg border-2 border-[#ff6a34] bg-white p-6 shadow-md">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#ff7038] px-3 py-1 text-[11px] font-bold uppercase text-white">
              Popular
            </span>
            <h2 className="text-base font-semibold">Team</h2>
            <p className="mt-1 text-sm text-[#5b6472]">For product squads</p>
            <p className="mt-6 text-[32px] font-bold">$49</p>
            <p className="text-sm text-[#5b6472]">per seat / month</p>
            <ul className="mt-6 space-y-3 text-sm text-[#5b6472]">
              <li>Unlimited pages</li>
              <li>Agent hook scans</li>
              <li>Figma baseline sync</li>
              <li>Batch fix + history</li>
            </ul>
            <button type="button" className="mt-8 w-full rounded-lg bg-[#f9683a] py-3 text-sm font-bold text-white">
              Start 14-day trial
            </button>
          </article>

          <article className="rounded-lg border border-[#e4e7ec] bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold">Enterprise</h2>
            <p className="mt-1 text-sm text-[#5b6472]">For design systems at scale</p>
            <p className="mt-6 text-[32px] font-bold">Custom</p>
            <p className="text-sm text-[#5b6472]">volume pricing</p>
            <ul className="mt-6 space-y-3 text-sm text-[#5b6472]">
              <li>SSO + audit logs</li>
              <li>Custom token policies</li>
              <li>Dedicated success engineer</li>
            </ul>
            <button type="button" className="mt-8 w-full rounded-[6px] bg-[#2563eb] py-3 text-sm font-semibold text-white">
              Contact sales
            </button>
          </article>
        </div>

        <section className="mt-16 rounded-lg bg-[#1a1a2e] px-8 py-10 text-center text-white" id="faq">
          <h2 className="text-[30px] font-bold">Questions?</h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] opacity-90">
            Our team responds within one business day. Or browse the docs for hook setup and Figma ingest.
          </p>
          <button type="button" className="mt-6 rounded-lg bg-[#27ae60] px-6 py-3 text-sm font-semibold text-white">
            Talk to sales
          </button>
        </section>
      </main>
    </div>
  );
}
