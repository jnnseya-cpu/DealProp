"use server";

import { revalidatePath } from "next/cache";
import { requireOneOf, type BoxFormResult } from "@/lib/formFields";
import {
  categoryDefinition,
  UK_INVESTOR_CATEGORISATION,
  type InvestorCategory,
} from "@/domain/jurisdictions/uk-financial-promotion";
import { saveAccount } from "@/store/repository";
import { currentViewer } from "@/app/operator/guard";
import { audit } from "@/lib/audit";

/**
 * Investor self-certification.
 *
 * This is the thing that actually unblocks sending deal material, and it is a
 * form rather than an FCA application. What it must produce is evidence: which
 * category, which criteria the person said were true, the exact words they
 * signed, and when. All four are stored, because the question asked later is
 * "what did they certify, and was it current?" — and a record that keeps only
 * the category cannot answer it.
 */

const CATEGORIES = new Set<string>(
  UK_INVESTOR_CATEGORISATION.categories.map((c) => c.category),
);

export async function certify(
  _previous: BoxFormResult | undefined,
  formData: FormData,
): Promise<BoxFormResult> {
  const viewer = await currentViewer();
  if (viewer?.kind !== "account") {
    return { ok: false, message: "Sign in with your own account before certifying." };
  }

  try {
    const category = requireOneOf<InvestorCategory>(
      formData.get("category"),
      CATEGORIES,
      "category",
    );
    const definition = categoryDefinition(category);
    if (definition === undefined) throw new Error("Unknown category");

    if (definition.requiresThirdPartyCertification) {
      // The certificate is signed by an authorised firm, not by us and not by
      // the investor. Accepting a self-signed one here would create a record
      // that looks like evidence and is not.
      return {
        ok: false,
        message: `A ${definition.label} certificate must be signed by an authorised person. Send us the certificate rather than completing this form.`,
      };
    }

    const criteriaMet = definition.criteria
      .map((c) => c.key)
      .filter((key) => formData.get(`criterion-${key}`) !== null);

    if (criteriaMet.length === 0) {
      return {
        ok: false,
        message: "Tick at least one statement that is true of you. Nothing is certified otherwise.",
      };
    }

    // The exact words signed, kept verbatim. A paraphrase is not the statement
    // the person made, and the statement is the evidence.
    const statementText = definition.criteria
      .filter((c) => criteriaMet.includes(c.key))
      .map((c) => c.text)
      .join(" ");

    const account = {
      ...viewer.account,
      certification: {
        category,
        criteriaMet,
        certifiedAt: new Date().toISOString(),
        statementText,
        rulesAsOf: UK_INVESTOR_CATEGORISATION.asOf,
      },
    };

    await saveAccount(account);
    await audit("certification-given", {
      account,
      subject: account.id,
      detail: `${definition.label} (${definition.citation}); criteria: ${criteriaMet.join(", ")}`,
    });
    revalidatePath("/", "layout");

    return {
      ok: true,
      message: `Recorded as ${definition.label}. This lapses in ${UK_INVESTOR_CATEGORISATION.certificationValidMonths} months and must be given again.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not record that.",
    };
  }
}
