import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { parseEnvFile } from "./env";

/**
 * Scaffold `.env.local`.
 *
 * Does exactly two things, and refusing to do a third is the point.
 *
 * It **generates the secrets that can be generated**. `OPERATOR_SECRET`,
 * `CRON_SECRET` and the rest are arbitrary high-entropy strings, and asking a
 * person to invent one produces `changeme` — which the preflight already
 * rejects by name, because it has seen it before.
 *
 * It **lists what only you can answer, and leaves those blank**. The company
 * number, the registered office, the ICO registration: a placeholder here is
 * not a missing disclosure, it is a false one. Companies Act 2006 s.82 wants
 * the real number on the website, and inventing one to make a check go green
 * is worse than the check being red.
 *
 * It never overwrites an existing value. A script that regenerates
 * `OPERATOR_SECRET` on a second run signs every operator out and invalidates
 * every session, and it would do it silently.
 *
 * Usage: npm run setup:env
 */

/** Secrets this can generate. Each is an arbitrary high-entropy string. */
const GENERATED: readonly { readonly key: string; readonly why: string }[] = [
  { key: "OPERATOR_SECRET", why: "Signs operator sessions. Without it every operator surface returns 503." },
  { key: "CRON_SECRET", why: "Authenticates the scheduled endpoints. Without it they refuse to run." },
];

/**
 * Facts about your company. Left blank deliberately.
 *
 * Every one is a statement to the public about who they are contracting with,
 * and there is no safe default for any of them.
 */
const YOURS: readonly { readonly key: string; readonly why: string }[] = [
  { key: "NEXT_PUBLIC_SITE_URL", why: "The public origin, e.g. https://lode.example — no trailing slash." },
  { key: "DATABASE_URL", why: "Postgres. Unset means the JSON file store, which is wrong on any host running more than one instance." },
  { key: "COMPANY_LEGAL_NAME", why: "The registered name, exactly as registered." },
  { key: "COMPANY_NUMBER", why: "Companies Act 2006 s.82 requires it on the website. It is also what lets a stranger check you exist." },
  { key: "COMPANY_PLACE_OF_REGISTRATION", why: "Which register to look in, e.g. England and Wales." },
  { key: "COMPANY_REGISTERED_OFFICE", why: "Where anything can be served on you. Quote it if it contains spaces." },
  { key: "ICO_REGISTRATION", why: "This platform processes health and capacity concerns sellers report. Processing that without a current registration is an offence." },
  { key: "CONTACT_EMAIL", why: "Somewhere a seller who wants to withdraw can write that is not a form." },
];

function secret(): string {
  // 32 bytes of CSPRNG, base64url. Comfortably past the 24-character floor the
  // preflight enforces, and safe to paste into a shell or a host's config UI.
  return randomBytes(32).toString("base64url");
}

function main(): void {
  const root = process.cwd();
  const target = path.join(root, ".env.local");
  const existing = existsSync(target) ? parseEnvFile(readFileSync(target, "utf8")) : {};
  const held = (key: string): boolean => (existing[key] ?? "").trim() !== "";

  const lines: string[] = [
    "# Written by `npm run setup:env`. Gitignored, and it must stay that way.",
    "#",
    "# Values already set are preserved: this file is never overwritten. Running",
    "# it again fills in what is blank and leaves everything else alone —",
    "# regenerating OPERATOR_SECRET would sign out every operator, silently.",
    "",
    "# --- Generated. No decision required. ---",
  ];

  const generated: string[] = [];
  for (const item of GENERATED) {
    lines.push(`# ${item.why}`);
    if (held(item.key)) {
      lines.push(`${item.key}=${existing[item.key] ?? ""}`);
    } else {
      lines.push(`${item.key}=${secret()}`);
      generated.push(item.key);
    }
    lines.push("");
  }

  lines.push("# --- Only you can answer these. A placeholder here is a false");
  lines.push("#     statement of identity, not a missing one. ---");
  lines.push("");

  const outstanding: string[] = [];
  for (const item of YOURS) {
    lines.push(`# ${item.why}`);
    lines.push(`${item.key}=${existing[item.key] ?? ""}`);
    lines.push("");
    if (!held(item.key)) outstanding.push(item.key);
  }

  // Anything already in the file that this script does not know about is kept.
  // Losing a working billing key because a scaffold did not list it would be a
  // considerably worse outcome than an untidy file.
  const known = new Set([...GENERATED, ...YOURS].map((i) => i.key));
  const carried = Object.entries(existing).filter(([key]) => !known.has(key));
  if (carried.length > 0) {
    lines.push("# --- Already set, carried through untouched. ---");
    lines.push("");
    for (const [key, value] of carried) lines.push(`${key}=${value}`);
    lines.push("");
  }

  writeFileSync(target, `${lines.join("\n")}\n`, { mode: 0o600 });

  const out = process.stdout;
  out.write(`Wrote .env.local\n\n`);
  out.write(
    generated.length > 0
      ? `Generated ${generated.length} secret(s): ${generated.join(", ")}\n`
      : "No secrets generated; the ones this can generate were already set.\n",
  );
  if (carried.length > 0) out.write(`Carried through ${carried.length} existing value(s).\n`);

  if (outstanding.length === 0) {
    out.write("\nNothing outstanding. Run `npm run preflight`.\n");
    return;
  }

  out.write(`\n${outstanding.length} value(s) only you can supply:\n`);
  for (const key of outstanding) {
    const item = YOURS.find((i) => i.key === key);
    out.write(`  ${key}\n    ${item?.why ?? ""}\n`);
  }
  out.write("\nFill them in, then run `npm run preflight`.\n");
  out.write("See .env.example for everything else — email, billing, discovery.\n");
}

main();
