import { chat } from './openai.js';

async function parseFollowupSpec({ baseUrl, apiKeyEnv, model, userText }) {
  // Returns a structured follow-up policy (or "use default") extracted from natural language.
  const schemaHint = {
    kind: 'use_default | custom',
    everyMin: 'number|null',
    maxCount: 'number|null',
    quietHours: { start: '0-23', end: '0-23' }
  };

  const content = await chat({
    baseUrl,
    apiKeyEnv,
    model,
    messages: [
      {
        role: 'system',
        content:
          'Extract reminder follow-up settings from the user. Respond with ONLY valid JSON. ' +
          'If the user wants defaults, set kind="use_default". ' +
          'If user says once/no followups, set kind="custom" and everyMin=null. ' +
          'quietHours uses local time. If user doesn\'t specify quiet hours, return null for quietHours. '
      },
      { role: 'user', content: `User said: ${userText}\nSchema: ${JSON.stringify(schemaHint)}` }
    ]
  });

  try {
    return JSON.parse(content);
  } catch {
    // heuristic fallback
    const t = userText.toLowerCase();
    if (t.includes('default')) return { kind: 'use_default' };
    if (t.includes('once')) return { kind: 'custom', everyMin: null, maxCount: null, quietHours: null };
    const m = t.match(/every\s+(\d+)\s*(min|mins|minute|minutes)/);
    if (m) return { kind: 'custom', everyMin: Number(m[1]), maxCount: null, quietHours: null };
    return { kind: 'use_default' };
  }
}

async function parseDefaultUpdate({ baseUrl, apiKeyEnv, model, userText }) {
  // Update defaults.followup based on natural language.
  const schemaHint = {
    mode: 'once | repeat',
    everyMin: 'number|null',
    maxCount: 'number|null',
    quietHours: { start: '0-23', end: '0-23' }
  };

  const content = await chat({
    baseUrl,
    apiKeyEnv,
    model,
    messages: [
      {
        role: 'system',
        content:
          'Extract DEFAULT follow-up settings the user wants. Respond with ONLY valid JSON. ' +
          'If user wants no followups, mode="once". ' +
          'If user wants repeating followups, mode="repeat" and set everyMin. '
      },
      { role: 'user', content: `User said: ${userText}\nSchema: ${JSON.stringify(schemaHint)}` }
    ]
  });

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function handleUtterance({ baseUrl, apiKeyEnv, model, text, state }) {
  // state: { pending, defaults }
  const t = text.trim();
  if (!t) return { say: "I didn't catch that. Try again.", state };

  // Mid-flow: ask for time
  if (state.pending?.kind === 'ask_time') {
    return {
      intent: 'set_time',
      timeText: t,
      say: `Okay — ${t}. If I remind you and you don’t respond, how should I handle follow-ups?`,
      state: { ...state, pending: { kind: 'ask_followup', reminderText: state.pending.reminderText, timeText: t } }
    };
  }

  // Mid-flow: follow-up policy
  if (state.pending?.kind === 'ask_followup') {
    const spec = await parseFollowupSpec({ baseUrl, apiKeyEnv, model, userText: t });
    return {
      intent: 'set_followup',
      followupSpec: spec,
      say: `Got it.`,
      state: {
        ...state,
        pending: null,
        collected: {
          reminderText: state.pending.reminderText,
          timeText: state.pending.timeText,
          followupSpec: spec
        }
      }
    };
  }

  // Update default follow-up settings conversationally
  if (/\b(default|defaults)\b/i.test(t) && /\bfollow\s*-?ups?\b/i.test(t)) {
    const upd = await parseDefaultUpdate({ baseUrl, apiKeyEnv, model, userText: t });
    if (upd) {
      return {
        intent: 'update_defaults',
        defaultsPatch: upd,
        say: `Okay — I updated your default follow-up settings.`,
        state
      };
    }
  }

  // If user says they completed something
  if (/\b(done|did it|completed|yes i did|yeah i did|yep i did)\b/i.test(t)) {
    return { intent: 'ack_latest', say: `Nice — I’ll mark that as done.`, state };
  }

  // Basic reminder detection
  if (/\b(remind me|i need to remember|don't let me forget|remember to)\b/i.test(t)) {
    return {
      intent: 'new_reminder',
      say: `Sure — what time should I remind you?`,
      state: { ...state, pending: { kind: 'ask_time', reminderText: t } }
    };
  }

  // Fallback chat
  const content = await chat({
    baseUrl,
    apiKeyEnv,
    model,
    messages: [
      { role: 'system', content: 'You are a helpful, conversational voice assistant running on a Raspberry Pi. Keep replies short (1-2 sentences) and natural.' },
      { role: 'user', content: t }
    ]
  });

  return { intent: 'chat', say: content, state };
}
