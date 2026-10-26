"use client";

/**
 * Review and print the drafted letter to a deceased estate's representatives.
 *
 * The letter is drafted on the server and shown here in full, so the operator
 * reads exactly what will go out — inside Lode — then prints it to post. It is
 * never sent from here: a letter to the bereaved is printed and posted by a
 * named person, which is the whole point of the probate route.
 */
export function PrintLetter({ letter }: { letter: string }) {
  function print() {
    const w = window.open("", "_blank", "width=820,height=1000");
    if (w === null) return;
    const escaped = letter
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Letter</title>` +
        `<style>@page{margin:25mm}` +
        `body{font:12pt/1.55 Georgia,"Times New Roman",serif;color:#111;white-space:pre-wrap;max-width:170mm}</style>` +
        `</head><body>${escaped}</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <details className="mt-3 rounded-lg border hairline bg-surface-2">
      <summary className="cursor-pointer px-4 py-2.5 text-sm text-ink-200">
        Letter to the executors — review &amp; print
      </summary>
      <div className="border-t hairline px-4 py-3">
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-300">
          {letter}
        </pre>
        <button
          type="button"
          onClick={print}
          className="mt-3 inline-flex h-8 items-center rounded-md bg-lode-400 px-3 text-[13px] font-medium text-ink-950 transition-colors hover:bg-lode-300"
        >
          Print this letter →
        </button>
        <p className="mt-2 text-[11px] leading-snug text-ink-500">
          Check every bracketed placeholder is filled before posting. Post it yourself — nothing is
          sent from here.
        </p>
      </div>
    </details>
  );
}
