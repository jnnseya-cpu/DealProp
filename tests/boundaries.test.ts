import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { glob } from "node:fs/promises";

/**
 * The layer boundaries, enforced.
 *
 * `src/` is split three ways and the split is only worth having if it cannot
 * quietly stop being true. A convention written in a README lasts until the
 * first person in a hurry; a failing test lasts.
 *
 *   src/shared/   pure and isomorphic. No Node APIs, no React, no Next, no
 *                 database. Safe to import from either side, and — because it
 *                 holds every figure the platform computes — testable without a
 *                 browser, a server or a network.
 *   src/backend/  server only. Storage, credentials, external adapters. May
 *                 import shared. Must never import a page or a component.
 *   src/app/      the frontend, at the path Next requires. May import both.
 *
 * The rule that matters most is the first one. `src/shared/domain` is where
 * every score, verdict and tax figure is decided, and the moment it can reach a
 * database or a request it stops being reproducible from its inputs alone.
 */

const SRC = path.join(process.cwd(), "src");

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of glob(`${dir}/**/*.{ts,tsx}`)) {
    out.push(entry);
  }
  return out;
}

/** Every module specifier a file imports or re-exports from. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+["']([^"']+)["']/g;
  const dynamic = /\bimport\(\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  for (const match of source.matchAll(dynamic)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  return specifiers;
}

function relative(file: string): string {
  return path.relative(process.cwd(), file);
}

describe("src/shared stays pure", () => {
  it("imports nothing from the backend or the frontend", async () => {
    // The direction of every arrow. Shared is the bottom of the stack, so it
    // has nothing below it to reach for.
    for (const file of await filesUnder(path.join(SRC, "shared"))) {
      for (const specifier of importsOf(file)) {
        expect(
          specifier.startsWith("@backend/") || specifier.startsWith("@/app"),
          `${relative(file)} imports ${specifier}`,
        ).toBe(false);
      }
    }
  });

  it("touches no Node API, no database driver and no framework", async () => {
    // This is what makes the engine reproducible from its inputs alone, and why
    // 295 tests run in about two seconds without a server.
    const forbidden = [/^node:/, /^pg$/, /^react/, /^next(\/|$)/, /^playwright$/];
    for (const file of await filesUnder(path.join(SRC, "shared"))) {
      for (const specifier of importsOf(file)) {
        for (const rule of forbidden) {
          expect(rule.test(specifier), `${relative(file)} imports ${specifier}`).toBe(false);
        }
      }
    }
  });

  it("reads no environment variable", async () => {
    // A figure that changes with configuration is not a figure anyone can
    // reproduce from the inputs they were shown.
    for (const file of await filesUnder(path.join(SRC, "shared"))) {
      expect(
        readFileSync(file, "utf8").includes("process.env"),
        `${relative(file)} reads process.env`,
      ).toBe(false);
    }
  });
});

describe("src/backend stays server-side", () => {
  it("imports no page, component or React", async () => {
    for (const file of await filesUnder(path.join(SRC, "backend"))) {
      for (const specifier of importsOf(file)) {
        expect(
          specifier.startsWith("@/app") || /^react/.test(specifier),
          `${relative(file)} imports ${specifier}`,
        ).toBe(false);
      }
    }
  });

  it("keeps domain logic out of the store", async () => {
    // The store puts records in and takes them out. It may name domain *types*
    // — it stores them — but calling a domain function from it is how storage
    // starts making decisions, and then two engines disagree.
    for (const file of await filesUnder(path.join(SRC, "backend", "store"))) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith("@shared/domain/")) continue;
        // Seeding is the exception: it builds fixtures and is a script.
        if (file.endsWith("seed.ts")) continue;
        const line = source
          .split("\n")
          .find((l) => l.includes(specifier) && l.includes("import"));
        expect(line?.includes("import type"), `${relative(file)} imports ${specifier} as a value`).toBe(
          true,
        );
      }
    }
  });
});

describe("the frontend depends downward only", () => {
  it("never has a shared or backend module import it", async () => {
    const below = [
      ...(await filesUnder(path.join(SRC, "shared"))),
      ...(await filesUnder(path.join(SRC, "backend"))),
    ];
    for (const file of below) {
      for (const specifier of importsOf(file)) {
        expect(specifier.startsWith("@/app"), `${relative(file)} imports ${specifier}`).toBe(false);
      }
    }
  });

  it("has every layer populated, so the test is not passing vacuously", async () => {
    expect((await filesUnder(path.join(SRC, "shared"))).length).toBeGreaterThan(20);
    expect((await filesUnder(path.join(SRC, "backend"))).length).toBeGreaterThan(8);
    expect((await filesUnder(path.join(SRC, "app"))).length).toBeGreaterThan(20);
  });
});
