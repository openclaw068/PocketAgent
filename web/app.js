const transcript = document.getElementById('transcript');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const debugEl = document.getElementById('debug');
const statusEl = document.getElementById('status');

function add(role, text) {
  const row = document.createElement('div');
  row.className = `msg ${role}`;
  const roleEl = document.createElement('div');
  roleEl.className = 'role';
  roleEl.textContent = role;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.appendChild(roleEl);
  row.appendChild(bubble);
  transcript.appendChild(row);
  transcript.scrollTop = transcript.scrollHeight;
}

async function health() {
  try {
    const res = await fetch('/health');
    if (!res.ok) throw new Error('bad');
    statusEl.textContent = 'online';
    statusEl.className = 'pill ok';
  } catch {
    statusEl.textContent = 'offline';
    statusEl.className = 'pill bad';
  }
}

function getKey() {
  return localStorage.getItem('pocketagent_access_key') || '';
}

async function turn(text) {
  const key = getKey();
  const res = await fetch('/api/turn', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'x-access-key': key } : {})
    },
    body: JSON.stringify({ text })
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'Request failed');
  return j;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  add('user', text);
  try {
    const j = await turn(text);
    add('assistant', j.assistant || '(no reply)');
    debugEl.textContent = JSON.stringify(j.debug, null, 2);
  } catch (err) {
    add('assistant', `Error: ${err.message}`);
  }
});

// Access key prompt (very simple)
if (!getKey()) {
  const k = prompt('Enter PocketAgent access key:');
  if (k) localStorage.setItem('pocketagent_access_key', k);
}

add('assistant', "Tell me what you want to remember, or ask what’s coming up today.");
health();
