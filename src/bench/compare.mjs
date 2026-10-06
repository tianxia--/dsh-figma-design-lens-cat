// Comparing two runs.
//
// The overall average moves for two different reasons: a render got better,
// or a render that used to fail now succeeds and drags the mean down with its
// low score. Those look identical in a single number, and one change read as
// a regression (20.1 to 19.9) while every render it touched improved.
//
// So a comparison reports both: the like-for-like change over renders present
// in both runs, and the coverage change separately.
export function compare(before, after) {
  const key = (r) => r.screen + "|" + r.platform;
  const okBefore = new Map((before.rows || []).filter((r) => r.ok).map((r) => [key(r), r]));
  const okAfter = new Map((after.rows || []).filter((r) => r.ok).map((r) => [key(r), r]));

  const common = [...okAfter.keys()].filter((k) => okBefore.has(k));
  const mean = (m, keys) => keys.length
    ? Math.round((keys.reduce((a, k) => a + (m.get(k).pixel || 0), 0) / keys.length) * 10) / 10
    : null;

  const gained = [...okAfter.keys()].filter((k) => !okBefore.has(k));
  const lost = [...okBefore.keys()].filter((k) => !okAfter.has(k));

  const movers = common
    .map((k) => ({ key: k, delta: Math.round(((okAfter.get(k).pixel || 0) - (okBefore.get(k).pixel || 0)) * 10) / 10 }))
    .filter((m) => Math.abs(m.delta) >= 1)
    .sort((a, b) => a.delta - b.delta);

  return {
    common: common.length,
    likeForLike: {
      before: mean(okBefore, common),
      after: mean(okAfter, common),
      delta: Math.round(((mean(okAfter, common) || 0) - (mean(okBefore, common) || 0)) * 10) / 10,
    },
    coverage: {
      before: okBefore.size,
      after: okAfter.size,
      gained: gained.length,
      lost: lost.length,
    },
    // Split by sign: taking the head and tail of one sorted list listed the
    // same improvement under both headings when nothing had regressed.
    regressed: movers.filter((m) => m.delta < 0).slice(0, 6),
    improved: movers.filter((m) => m.delta > 0).reverse().slice(0, 6),
  };
}
