// Which items the generated code actually contains.
//
// The same payload sent three times produces three different omissions: one
// run lost a screen's background and both round tool buttons, another lost
// different ones. That is the model, not the data, and no wording removes it
// entirely -- so the result is checked rather than trusted.
//
// Every emitted element carries its item id (data-id on web,
// accessibilityIdentifier on SwiftUI, testTag on Compose), which makes the
// check exact instead of a guess from pixels.

/** Item ids present in generated code, whichever target it is for. */
export function emittedIds(code) {
  const found = new Set();
  const patterns = [
    /data-id="([^"]+)"/g,                       // web
    /accessibilityIdentifier\("([^"]+)"\)/g,    // SwiftUI
    /testTag\("([^"]+)"\)/g,                    // Compose
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code))) found.add(m[1]);
  }
  return found;
}

/**
 * What the model left out.
 *
 * Returns null when nothing can be checked -- an older generation carries no
 * tags, and reporting every item as missing would be worse than saying
 * nothing.
 */
export function missingItems(code, items) {
  const emitted = emittedIds(code);
  if (!emitted.size) return null;
  const missing = items.filter((i) => !emitted.has(i.id));
  return {
    expected: items.length,
    emitted: emitted.size,
    missing: missing.map((i) => ({
      id: i.id, name: i.name || null,
      box: i.box, fill: i.fill || null,
      text: i.text ? String(i.text).slice(0, 24) : null,
    })),
  };
}
