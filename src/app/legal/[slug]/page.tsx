import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/app/components/chrome";
import { SiteFooter } from "@/app/components/SiteFooter";
import { siteUrl, SITE_NAME } from "@backend/site";
import { canonical } from "@shared/domain/blog";
import { companyIdentity, registrationLine } from "@shared/domain/identity";
import { LEGAL_DOCUMENTS, legalDocument, type NavLink } from "@shared/domain/legal";

/*
 * Not indefinitely static: the identity block beside each policy is read from
 * the environment at render time, and the Dockerfile passes no company identity
 * at build. An hour is the window after a deploy, not a permanent state.
 */
export const revalidate = 3600;

export function generateStaticParams(): { slug: string }[] {
  return LEGAL_DOCUMENTS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = legalDocument(slug);
  if (doc === undefined) return { title: `Not found — ${SITE_NAME}` };
  return {
    title: `${doc.title} — ${SITE_NAME}`,
    description: doc.summary,
    alternates: { canonical: canonical(siteUrl(), `/legal/${doc.slug}`) },
  };
}

function Reference({ link }: { link: NavLink }) {
  const external = link.href.startsWith("http");
  const className = "text-lode-300 underline underline-offset-2 transition-colors hover:text-lode-200";
  return external ? (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
      {link.label}
    </a>
  ) : (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  );
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = legalDocument(slug);
  if (doc === undefined) notFound();

  const identity = companyIdentity(process.env);
  const registration = registrationLine(identity);
  // The data-protection contact is the right address for a privacy or data
  // matter; the general contact for everything else. Either may be unset.
  const dataMatter = doc.slug === "privacy" || doc.slug === "cookies";
  const contact =
    (dataMatter ? identity.dataProtectionContact : undefined) ?? identity.contactEmail;

  const updated = new Date(doc.updated).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        width="max-w-3xl"
        trailing={
          <Link href="/" className="text-xs text-ink-500 transition-colors hover:text-ink-100">
            Back to home
          </Link>
        }
      />

      <article className="mx-auto max-w-3xl px-6 pt-14">
        <span className="eyebrow">Legal</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {doc.title}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-300">{doc.summary}</p>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-ink-500">
          Last updated {updated}
        </p>

        <div className="mt-10 space-y-10">
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="font-display text-xl text-ink-100">{section.heading}</h2>
              <div className="mt-3 space-y-3">
                {section.body.map((paragraph, i) => (
                  <p key={i} className="text-sm leading-relaxed text-ink-300">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        {doc.links !== undefined && doc.links.length > 0 && (
          <section className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-4">
            <h2 className="eyebrow">See also</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {doc.links.map((link) => (
                <li key={link.href}>
                  <Reference link={link} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Who we are — read from the environment, never hardcoded. A policy that
            stated a placeholder company number would state a false one. */}
        <section className="mt-10 border-t hairline pt-8">
          <h2 className="eyebrow">Who we are, and how to reach us</h2>
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-ink-400">
            {registration !== undefined ? (
              <p>{registration}</p>
            ) : (
              <p className="text-amber-300">
                Company registration details have not yet been configured for this deployment.
              </p>
            )}
            {identity.registeredOffice !== undefined && (
              <p>Registered office: {identity.registeredOffice}</p>
            )}
            {contact !== undefined ? (
              <p>
                {dataMatter ? "For any question about your information, contact " : "Contact us at "}
                <a
                  href={`mailto:${contact}`}
                  className="text-lode-300 underline underline-offset-2 transition-colors hover:text-lode-200"
                >
                  {contact}
                </a>
                .
              </p>
            ) : (
              <p className="text-amber-300">A contact address has not yet been configured.</p>
            )}
            {dataMatter && identity.icoRegistration !== undefined && (
              <p>Registered with the Information Commissioner's Office, {identity.icoRegistration}.</p>
            )}
            {doc.slug === "complaints" && identity.redressScheme !== undefined && (
              <p>{identity.redressScheme}.</p>
            )}
          </div>
        </section>
      </article>

      <SiteFooter width="max-w-3xl" />
    </main>
  );
}
