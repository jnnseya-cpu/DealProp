import { describe, expect, it } from "vitest";
import {
  FOOTER_COMPANY,
  FOOTER_LEGAL,
  FOOTER_PRODUCT,
  LEGAL_DOCUMENTS,
  legalDocument,
} from "@shared/domain/legal";

/**
 * The point of putting the policies and the footer links in one module is that
 * a link cannot go somewhere that does not exist. These tests walk both
 * directions so a renamed slug fails here, not in a visitor's browser.
 */
describe("legal documents and footer navigation", () => {
  it("gives every document a unique slug and real content", () => {
    const slugs = LEGAL_DOCUMENTS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.title.length, doc.slug).toBeGreaterThan(3);
      expect(doc.navLabel.length, doc.slug).toBeGreaterThan(2);
      expect(doc.summary.length, doc.slug).toBeGreaterThan(20);
      expect(doc.sections.length, doc.slug).toBeGreaterThan(0);
      for (const section of doc.sections) {
        expect(section.heading.length, `${doc.slug}/${section.heading}`).toBeGreaterThan(2);
        expect(section.body.length, `${doc.slug}/${section.heading}`).toBeGreaterThan(0);
        for (const p of section.body) expect(p.length).toBeGreaterThan(20);
      }
    }
  });

  it("resolves every legal link in the footer to a document", () => {
    for (const link of FOOTER_LEGAL) {
      const slug = link.href.replace(/^\/legal\//, "");
      expect(legalDocument(slug), link.href).toBeDefined();
    }
  });

  it("has a document for every slug, reachable from the footer", () => {
    const linked = new Set(FOOTER_LEGAL.map((l) => l.href.replace(/^\/legal\//, "")));
    for (const doc of LEGAL_DOCUMENTS) {
      expect(linked.has(doc.slug), doc.slug).toBe(true);
    }
  });

  it("includes the policies referenced elsewhere in the app", () => {
    // sources.ts points sellers at /legal/privacy and funders at /legal/outreach;
    // the enquiry form links the privacy notice. These must exist.
    expect(legalDocument("privacy")).toBeDefined();
    expect(legalDocument("outreach")).toBeDefined();
  });

  it("never emits an empty or malformed href", () => {
    for (const link of [...FOOTER_PRODUCT, ...FOOTER_COMPANY, ...FOOTER_LEGAL]) {
      expect(link.href.startsWith("/"), link.label).toBe(true);
      expect(link.label.length, link.href).toBeGreaterThan(1);
    }
  });

  it("links About and How it works from the company column", () => {
    const hrefs = FOOTER_COMPANY.map((l) => l.href);
    expect(hrefs).toContain("/about");
    expect(hrefs).toContain("/how-it-works");
  });
});
