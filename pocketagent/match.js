function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  const t = norm(s);
  return t ? new Set(t.split(' ')) : new Set();
}

export function scoreMatch({ query, text }) {
  const q = norm(query);
  const d = norm(text);
  if (!q || !d) return 0;

  // Strong signals
  if (d === q) return 100;
  if (d.includes(q)) return 80;

  const qt = tokens(q);
  const dt = tokens(d);
  if (!qt.size || !dt.size) return 0;

  let overlap = 0;
  for (const w of qt) if (dt.has(w)) overlap += 1;

  // token overlap ratio (0..1)
  const ratio = overlap / Math.max(1, qt.size);

  // Base score from overlap
  let score = Math.round(ratio * 60);

  // Bonus if any query token is a substring of the reminder text
  for (const w of qt) {
    if (w.length >= 4 && d.includes(w)) score += 5;
  }

  return Math.min(95, Math.max(0, score));
}

export function bestReminderMatch({ reminders, queryText }) {
  const list = Array.isArray(reminders) ? reminders : [];
  let best = null;
  let bestScore = 0;

  for (const r of list) {
    const s = scoreMatch({ query: queryText, text: r?.text || '' });
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }

  return { best, bestScore };
}
