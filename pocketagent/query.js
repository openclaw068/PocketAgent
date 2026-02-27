import { chat } from './openai.js';

function dayBoundsLocalIso({ which = 'today', now = new Date() }) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (which === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  }
  if (which === 'tomorrow') {
    start.setDate(start.getDate() + 1);
    end.setDate(end.getDate() + 1);
  }

  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export async function answerReminderQuery({ baseUrl, apiKeyEnv, model, queryText, reminders }) {
  // reminders: array of reminders objects
  const sys =
    'You are PocketAgent, a reminders-only assistant. ' +
    'Given a user question and a list of stored reminders, answer succinctly. ' +
    'If there are none, say so. ' +
    'Only talk about reminders and follow-up settings; refuse other topics.';

  const content = await chat({
    baseUrl,
    apiKeyEnv,
    model,
    messages: [
      { role: 'system', content: sys },
      {
        role: 'user',
        content: JSON.stringify({ queryText, reminders }, null, 2)
      }
    ]
  });

  return content;
}

export function selectRemindersForQuery(engine, queryText) {
  const t = (queryText || '').toLowerCase();
  if (t.includes('yesterday')) {
    const { startIso, endIso } = dayBoundsLocalIso({ which: 'yesterday' });
    return engine.listByDateRange({ startIso, endIso, status: null });
  }
  if (t.includes('tomorrow')) {
    const { startIso, endIso } = dayBoundsLocalIso({ which: 'tomorrow' });
    return engine.listByDateRange({ startIso, endIso, status: 'open' });
  }
  if (t.includes('today')) {
    const { startIso, endIso } = dayBoundsLocalIso({ which: 'today' });
    return engine.listByDateRange({ startIso, endIso, status: 'open' });
  }
  if (t.includes('all')) {
    return engine.listAll();
  }
  // default: show open upcoming
  return engine.listOpen();
}
