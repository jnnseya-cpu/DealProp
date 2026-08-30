import { addSuppression } from "@backend/store/repository";
import { SiteHeader } from "@/app/components/chrome";

export const dynamic = "force-dynamic";

export const metadata = { title: "Opt out — Lode", robots: { index: false } };

/**
 * The opt-out link carried by every outreach message.
 *
 * One click, no account, no confirmation step, no form asking why. Anything
 * that stands between somebody and being left alone is a reason for them to
 * complain instead, and they would be right.
 *
 * Deliberately not a capability URL: the address is in the link because the
 * recipient already has it, it is their own, and requiring a token would mean a
 * forwarded message could not be used to opt out by the person who received it.
 */
export default async function OptOutPage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const { address } = await searchParams;
  const email = (address ?? "").trim().toLowerCase();
  const valid = email.includes("@") && email.length < 254;

  if (valid) {
    await addSuppression({
      email,
      reason: "Opted out through the link in an outreach message.",
      at: new Date().toISOString(),
    });
  }

  return (
    <main className="min-h-screen">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-6 py-24">
        <h1 className="font-display text-3xl leading-tight text-ink-100">
          {valid ? "You will not hear from us again" : "We need the address"}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-300">
          {valid
            ? `${email} has been added to our suppression list. It is checked before every message we send, so this takes effect immediately and across everything — not just the enquiry you received.`
            : "The link did not carry an address. Reply to the message you received with “remove me” and it will be actioned automatically."}
        </p>
        <p className="mt-6 text-sm leading-relaxed text-ink-400">
          We write to funders about property transactions we are working on. We do not sell or share
          contact details, and we only ever use an address an organisation has published for
          enquiries.
        </p>
      </div>
    </main>
  );
}
