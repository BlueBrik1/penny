// Pricing kitchen-sink (Tailwind) — mirrors CSS demo drifts for JSX/markup parsing.
export function PricingCard() {
  return (
    <div className="max-w-lg space-y-6 p-6 text-[#1a1a2e]">
      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#5b6472]">Typography drift</h2>
        <p className="text-base font-normal">Body 16px ✓</p>
        <p className="text-base font-bold">Body bold</p>
        <p className="text-[17px]">17px body drift</p>
        <h3 className="text-[32px] font-bold">Heading 32px ✓</h3>
        <p className="text-[30px] font-bold">30px heading drift</p>
        <p className="text-[14px] text-[#5b6472]">14px off-scale</p>
        <p className="text-[12px] text-[#5b6472]">12px off-scale</p>
        <p className="text-[18px]">18px off-scale</p>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#5b6472]">Brand splinter</h2>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-lg bg-[#ff6b35] px-3 py-2 text-xs font-semibold text-white">#ff6b35</span>
          <span className="rounded-lg bg-[#ff6a34] px-3 py-2 text-xs font-semibold text-white">#ff6a34</span>
          <span className="rounded-lg bg-[#f9683a] px-3 py-2 text-xs font-semibold text-white">#f9683a</span>
          <span className="rounded-lg bg-[#ff7038] px-3 py-2 text-xs font-semibold text-white">#ff7038</span>
          <span className="rounded-lg bg-[#fe6830] px-3 py-2 text-xs font-semibold text-white">#fe6830</span>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#5b6472]">Off-palette colors</h2>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-lg bg-[#3b82f6] px-3 py-2 text-xs text-white">Blue</span>
          <span className="rounded-lg bg-[#7c3aed] px-3 py-2 text-xs text-white">Purple</span>
          <span className="rounded-lg bg-[#14b8a6] px-3 py-2 text-xs text-white">Teal</span>
          <span className="rounded-lg bg-[#27ae60] px-3 py-2 text-xs text-white">Green drift</span>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#5b6472]">Spacing drift</h2>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-lg border border-[#e4e7ec] p-4 text-xs">p-4 · 16px ✓</div>
          <div className="rounded-lg border border-[#e4e7ec] p-[15px] text-xs">p-[15px] drift</div>
          <div className="rounded-lg border border-[#e4e7ec] p-[13px] text-xs">p-[13px] off-scale</div>
          <div className="rounded-lg border border-[#e4e7ec] p-[20px] text-xs">p-[20px] off-scale</div>
        </div>
        <div className="mt-3 flex gap-[20px]">
          <div className="rounded border border-dashed border-[#ff6b35] p-3 text-xs">gap 20px</div>
          <div className="rounded border border-dashed border-[#ff6b35] p-3 text-xs">gap 20px</div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#5b6472]">Button size &amp; shape</h2>
        <div className="flex flex-wrap gap-3">
          <button className="rounded-lg bg-[#ff6b35] px-3 py-2 text-sm font-semibold text-white">Small</button>
          <button className="rounded-lg bg-[#ff6a34] px-4 py-4 text-base font-semibold text-white">Medium</button>
          <button className="rounded-lg bg-[#f9683a] px-6 py-6 text-base font-bold text-white">Large</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <button className="rounded bg-[#ff6b35] px-4 py-3 text-sm font-semibold text-white">4px</button>
          <button className="rounded-lg bg-[#ff6b35] px-4 py-3 text-sm font-semibold text-white">8px</button>
          <button className="rounded-full bg-[#ff6b35] px-6 py-3 text-sm font-semibold text-white">Pill</button>
          <button className="rounded-[6px] bg-[#ff6b35] px-4 py-3 text-sm font-semibold text-white">6px off</button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#5b6472]">Radius &amp; margin</h2>
        <div className="flex flex-wrap gap-3">
          <div className="flex h-12 w-16 items-center justify-center rounded-[6px] bg-[#ff6b35] text-[11px] font-semibold text-white">6px</div>
          <div className="flex h-12 w-16 items-center justify-center rounded-[12px] bg-[#ff6a34] text-[11px] font-semibold text-white">12px</div>
          <div className="flex h-12 w-20 items-center justify-center rounded-full bg-[#f9683a] text-[11px] font-semibold text-white">pill</div>
        </div>
        <div className="mt-3 flex flex-col">
          <div className="mb-[13px] rounded-lg border border-[#e4e7ec] p-3 text-xs">13px margin</div>
          <div className="mb-[18px] rounded-lg border border-[#e4e7ec] p-3 text-xs">18px margin</div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[#5b6472]">Dark &amp; extra palette</h2>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-lg bg-[#4f46e5] px-3 py-2 text-xs font-semibold text-white">Indigo</span>
          <span className="rounded-lg bg-[#e11d48] px-3 py-2 text-xs font-semibold text-white">Rose</span>
          <span className="rounded-lg bg-[#f59e0b] px-3 py-2 text-xs font-semibold text-[#1a1a2e]">Amber</span>
          <button className="rounded-lg bg-[#de4f26] px-4 py-3 text-sm font-semibold text-white">Dark drift</button>
        </div>
      </section>

      <section className="rounded-xl bg-[#fafafa] p-6">
        <h2 className="text-[18px] font-bold">Pro plan card</h2>
        <button className="mt-3 bg-[#ff6a34] p-4 text-white">Start free trial</button>
        <button className="mt-2 bg-[#f9683a] p-4 text-white">Talk to sales</button>
        <a className="mt-2 block text-[#7c3aed]">Compare plans</a>
        <span className="mt-2 inline-block bg-[#ff6b35] px-2 py-1 text-xs font-bold text-white">Popular</span>
      </section>
    </div>
  );
}
