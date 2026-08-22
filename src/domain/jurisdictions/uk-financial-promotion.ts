import { fromMajor, type Money } from "@/lib/money";

/**
 * UK financial promotion exemptions: investor categorisation.
 *
 * A deal pack sent to a private investor is a financial promotion under FSMA
 * s.21. It must be made or approved by an authorised person **or fall within an
 * exemption**. The exemptions are the route this platform can actually use
 * today, and they turn on the investor certifying which category they fall in.
 *
 * That is why "we need authorisation before deal material reaches investors" is
 * the wrong conclusion. What is needed first is a **categorisation record**: a
 * signed statement, dated, renewed annually, kept. It is a form and a table,
 * not an FCA application.
 *
 * This lives in `jurisdictions/` because it is country-specific law, and it is
 * a single UK-wide module rather than a copy in each pack because the Financial
 * Promotion Order applies identically in England, Wales, Scotland and Northern
 * Ireland. All four packs reference this one table.
 *
 * ---
 *
 * THRESHOLDS ARE A DATED SNAPSHOT AND ARE CONTESTED. The Financial Promotion
 * (Amendment) Order 2023 raised the high-net-worth thresholds from £100,000
 * income and £250,000 net assets, and narrowed the self-certified sophisticated
 * criteria, from 31 January 2024. The government then announced it would
 * reverse those changes. The figures below are recorded with the date they were
 * captured and `requiresVerification` set, exactly as the transfer tax bands
 * are: the dangerous failure here is not a wrong number, it is a wrong number
 * that still looks plausible. Confirm against the current Order before relying
 * on this to disapply s.21.
 */

export type InvestorCategory =
  /** Certified high net worth individual. FPO art. 48. */
  | "high-net-worth"
  /** Self-certified sophisticated investor. FPO art. 50A. */
  | "self-certified-sophisticated"
  /** Certified sophisticated investor — requires an authorised firm's sign-off. FPO art. 50. */
  | "certified-sophisticated"
  /** Professional client / investment professional. FPO art. 19. */
  | "investment-professional"
  /** Restricted investor: capped at 10% of net assets. COBS 4.7.10R. */
  | "restricted"
  /** No certification held. Deal material must not be sent. */
  | "none";

export interface CategoryStatement {
  readonly key: string;
  /** The declaration the investor makes, in the first person, as they must. */
  readonly text: string;
}

export interface CategoryDefinition {
  readonly category: InvestorCategory;
  readonly label: string;
  /** The article of the Financial Promotion Order this rests on. */
  readonly citation: string;
  /** At least one must be true, and the investor must say which. */
  readonly criteria: readonly CategoryStatement[];
  /** True where deal material may be sent to someone in this category. */
  readonly mayReceiveDealMaterial: boolean;
  /**
   * True where certification requires a third party — an authorised firm —
   * rather than the investor's own signature.
   */
  readonly requiresThirdPartyCertification: boolean;
}

export interface InvestorCategorisationRules {
  /** Date these figures were captured. ISO-8601. */
  readonly asOf: string;
  /** True while the figures have not been confirmed against the current Order. */
  readonly requiresVerification: boolean;
  readonly sources: readonly string[];
  /** Income in the last financial year qualifying as high net worth. */
  readonly highNetWorthIncome: Money;
  /** Net assets, excluding primary residence and pensions, qualifying as HNW. */
  readonly highNetWorthNetAssets: Money;
  /** Months a certification remains valid before it must be renewed. */
  readonly certificationValidMonths: number;
  /** Share of net assets a restricted investor may commit, basis points. */
  readonly restrictedInvestorCapBps: number;
  readonly categories: readonly CategoryDefinition[];
}

export const UK_INVESTOR_CATEGORISATION: InvestorCategorisationRules = {
  asOf: "2026-08-22",
  // Deliberately true. See the note above: the thresholds were raised and the
  // change was then announced for reversal. Nobody should disapply s.21 on the
  // strength of a figure in a repository.
  requiresVerification: true,
  sources: [
    "Financial Services and Markets Act 2000 (Financial Promotion) Order 2005, arts. 19, 48, 50, 50A",
    "Financial Services and Markets Act 2000 (Financial Promotion) (Amendment) Order 2023",
    "FCA Handbook COBS 4.7 and 4.12B",
  ],
  highNetWorthIncome: fromMajor(170_000),
  highNetWorthNetAssets: fromMajor(430_000),
  // The statement is valid for twelve months from signature and must then be
  // made again. An expired certificate is not a weaker certificate; it is no
  // certificate, and sending on the strength of one is an unlawful promotion.
  certificationValidMonths: 12,
  restrictedInvestorCapBps: 1_000,

  categories: [
    {
      category: "high-net-worth",
      label: "Certified high net worth individual",
      citation: "FPO art. 48",
      mayReceiveDealMaterial: true,
      requiresThirdPartyCertification: false,
      criteria: [
        {
          key: "income",
          text: "I had, during the last financial year, an annual income to the value of £170,000 or more. Income does not include money withdrawn from a pension savings account.",
        },
        {
          key: "net-assets",
          text: "I held, throughout the last financial year, net assets to the value of £430,000 or more. Net assets do not include my primary residence or any loan secured on it, my pension savings, or rights under qualifying contracts of insurance.",
        },
      ],
    },
    {
      category: "self-certified-sophisticated",
      label: "Self-certified sophisticated investor",
      citation: "FPO art. 50A",
      mayReceiveDealMaterial: true,
      requiresThirdPartyCertification: false,
      criteria: [
        {
          key: "director",
          text: "I am, or have been in the last two years, a director of a company with an annual turnover of at least £1.6 million.",
        },
        {
          key: "unlisted-investments",
          text: "I have made more than one investment in an unlisted company in the last two years.",
        },
        {
          key: "sme-finance",
          text: "I have worked in the last two years in a professional capacity in the private equity sector, or in the provision of finance for small and medium enterprises.",
        },
        {
          key: "angel-network",
          text: "I am currently, or have been in the last two years, a member of a network or syndicate of business angels for at least six months.",
        },
      ],
    },
    {
      category: "certified-sophisticated",
      label: "Certified sophisticated investor",
      citation: "FPO art. 50",
      mayReceiveDealMaterial: true,
      // The certificate is signed by an authorised firm, not by the investor.
      // This platform cannot issue one and must not present a form that looks
      // as though it can.
      requiresThirdPartyCertification: true,
      criteria: [
        {
          key: "authorised-certificate",
          text: "I hold a current certificate signed by an authorised person confirming that I am sufficiently knowledgeable to understand the risks associated with this description of investment.",
        },
      ],
    },
    {
      category: "investment-professional",
      label: "Investment professional",
      citation: "FPO art. 19",
      mayReceiveDealMaterial: true,
      requiresThirdPartyCertification: false,
      criteria: [
        {
          key: "authorised-firm",
          text: "I am an authorised person, or I act in the capacity of a director or employee of an authorised person and this material relates to my employment.",
        },
      ],
    },
    {
      category: "restricted",
      label: "Restricted investor",
      citation: "COBS 4.7.10R",
      // Deliberately false. A restricted investor may receive certain
      // restricted mass market investments; an unregulated property deal pack
      // is not what that exemption was written for, and treating it as though
      // it were is the mistake this table exists to prevent.
      mayReceiveDealMaterial: false,
      requiresThirdPartyCertification: false,
      criteria: [
        {
          key: "ten-percent",
          text: "In the last twelve months I have not invested more than 10% of my net assets in restricted mass market investments, and I will not do so in the next twelve months.",
        },
      ],
    },
  ],
};

export function categoryDefinition(
  category: InvestorCategory,
): CategoryDefinition | undefined {
  return UK_INVESTOR_CATEGORISATION.categories.find((c) => c.category === category);
}
