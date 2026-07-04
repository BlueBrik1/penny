// Meridian signup flow — React + Tailwind with intentional drift
import React, { useState } from 'react';

export function SignupFlow() {
  const [step, setStep] = useState(1);

  return (
    <div className="flex min-h-screen bg-white">
      <aside className="hidden w-[42%] bg-[#1a1a2e] p-12 text-[#ede9df] lg:flex lg:flex-col lg:justify-between">
        <div>
          <div className="mb-10 flex items-center gap-3">
            <span className="h-9 w-9 rounded-lg bg-[#ff6b35]" />
            <span className="text-xl font-bold">Meridian</span>
          </div>
          <h1 className="text-[32px] font-bold leading-tight tracking-tight">
            Align design and code from day one
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed text-[#94a3b8]">
            Join teams who catch token drift before it ships. Setup takes under two minutes.
          </p>
        </div>
        <blockquote className="border-l-2 border-[#ff7038] pl-4 text-[14px] italic text-[#cbd5e1]">
          &ldquo;Meridian cut our brand inconsistency tickets by half in the first month.&rdquo;
          <footer className="mt-2 not-italic text-[12px] text-[#64748b]">— Alex Chen, VP Design, Forma</footer>
        </blockquote>
      </aside>

      <main className="flex flex-1 flex-col justify-center px-8 py-12 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex gap-2">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className={`h-1 flex-1 rounded-full ${n <= step ? 'bg-[#ff6a34]' : 'bg-[#e4e7ec]'}`}
              />
            ))}
          </div>

          <h2 className="text-[30px] font-bold text-[#1a1a2e]">
            {step === 1 ? 'Create your workspace' : step === 2 ? 'Connect your repo' : 'Invite your team'}
          </h2>
          <p className="mt-2 text-[14px] text-[#5b6472]">
            Step {step} of 3 · {step === 1 ? 'Account details' : step === 2 ? 'Optional GitHub link' : 'Collaborators'}
          </p>

          {step === 1 && (
            <form className="mt-8 space-y-5" onSubmit={(e) => { e.preventDefault(); setStep(2); }}>
              <label className="block">
                <span className="text-sm font-medium text-[#1a1a2e]">Work email</span>
                <input
                  type="email"
                  className="mt-1.5 w-full rounded-lg border border-[#e4e7ec] px-4 py-[13px] text-[16px] outline-none focus:border-[#ff6b35]"
                  placeholder="you@company.com"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-[#1a1a2e]">Password</span>
                <input
                  type="password"
                  className="mt-1.5 w-full rounded-lg border border-[#e4e7ec] px-4 py-3 text-[16px]"
                />
              </label>
              <button
                type="submit"
                className="w-full rounded-lg bg-[#ff7038] py-4 text-[16px] font-bold text-white"
              >
                Continue
              </button>
            </form>
          )}

          {step === 2 && (
            <div className="mt-8 space-y-5">
              <div className="rounded-lg border border-dashed border-[#e4e7ec] bg-[#f7f8fa] p-6 text-center">
                <p className="text-sm text-[#5b6472]">Paste a repo URL or browse locally</p>
                <input
                  type="text"
                  className="mt-4 w-full rounded-lg border border-[#e4e7ec] px-4 py-3 text-[15px]"
                  placeholder="github.com/org/design-system"
                />
              </div>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="w-full rounded-lg bg-[#f9683a] py-4 text-[16px] font-bold text-white"
              >
                Connect & continue
              </button>
              <button type="button" onClick={() => setStep(3)} className="w-full text-sm text-[#5b6472]">
                Skip for now
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="mt-8 space-y-5">
              <label className="block">
                <span className="text-sm font-medium">Invite emails (comma separated)</span>
                <textarea
                  className="mt-1.5 w-full rounded-lg border border-[#e4e7ec] px-4 py-3 text-[14px]"
                  rows={4}
                  placeholder="design@company.com, eng@company.com"
                />
              </label>
              <button
                type="button"
                className="w-full rounded-lg bg-[#3b82f6] py-4 text-[16px] font-semibold text-white"
              >
                Launch dashboard
              </button>
            </div>
          )}

          <p className="mt-8 text-center text-[12px] text-[#94a3b8]">
            By continuing you agree to our Terms and Privacy Policy.
          </p>
        </div>
      </main>
    </div>
  );
}
