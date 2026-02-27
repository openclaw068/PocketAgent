import { spawn } from 'node:child_process';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', d => (out += d.toString()));
    p.stderr.on('data', d => (err += d.toString()));
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) return resolve({ out, err });
      reject(new Error(`${cmd} ${args.join(' ')} failed (${code}): ${err || out}`));
    });
  });
}

export async function setVolumePercent({ card = null, control = 'Speaker', percent }) {
  const p = Math.max(0, Math.min(100, Number(percent)));
  const args = [];
  if (card !== null && card !== undefined) args.push('-c', String(card));
  args.push('sset', control, `${p}%`);
  await run('amixer', args);
  return p;
}

export async function listControls({ card = null }) {
  const args = [];
  if (card !== null && card !== undefined) args.push('-c', String(card));
  args.push('scontrols');
  const { out } = await run('amixer', args);
  return out;
}
