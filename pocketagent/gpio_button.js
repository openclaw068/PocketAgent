import { spawn, spawnSync } from 'node:child_process';

// Uses libgpiod's `gpiomon` to listen for button press/release events.
// This avoids native Node builds and works well on Raspberry Pi OS.
//
// For Raspiaudio ULTRA++ HAT, the forum pinout says: BUTTON = GPIO23 (PIN16)
// In libgpiod naming this is usually line 23 on gpiochip0.

export function startButtonWatcher({
  gpioChip = process.env.POCKETAGENT_GPIO_CHIP || 'gpiochip0',
  line = Number(process.env.POCKETAGENT_PTT_GPIO_LINE ?? 23),
  debounceMs = Number(process.env.POCKETAGENT_PTT_DEBOUNCE_MS ?? 60),
  // ULTRA++ button uses an external pull-up (per Raspiaudio guide), which typically means
  // the line is HIGH when idle and goes LOW when pressed => activeLow=true.
  activeLow = (process.env.POCKETAGENT_PTT_ACTIVE_LOW ?? 'true').toLowerCase() === 'true'
} = {}) {
  // gpiomon flag compatibility across libgpiod versions:
  // - Newer versions: -p/--debounce-period
  // - Some older builds: -B
  // Also, %E prints "rising"/"falling" (strings); %e is numeric.
  const help = spawnSync('gpiomon', ['--help'], { encoding: 'utf8' });
  const helpText = `${help.stdout || ''}\n${help.stderr || ''}`;

  const supportsFormatF = helpText.includes('--format') || helpText.includes('-F,') || helpText.includes('-F, --format') || helpText.includes(' -F,') || helpText.includes(' -F ');
  const supportsLineBuffered = helpText.includes('--line-buffered') || helpText.includes('-b,');
  const supportsActiveLow = helpText.includes('--active-low') || helpText.includes('-l,');

  // NOTE: gpiomon CLI varies across libgpiod versions.
  // - On this Pi's gpiomon, `-n` requires a number (num events). Passing `-n` with no value
  //   causes the next flag (like -F) to be parsed as the numeric value, producing
  //   confusing errors like: "invalid number: -F".
  // - On many versions, `-B` is bias (not debounce), so passing a number produces
  //   "invalid bias: <num>".
  //
  // So we avoid -n and -B entirely.
  const args = [];

  // Prefer a stable, parseable output format when supported.
  // %e is numeric event type: 0=failing, 1=rising (per gpiomon --help)
  if (supportsFormatF) args.push('-F', '%e');
  if (supportsLineBuffered) args.push('-b');
  if (supportsActiveLow && activeLow) args.push('-l');

  // (No debounce flag is portable across these versions.)
  void debounceMs; // reserved

  args.push(String(gpioChip), String(line));

  const listeners = { press: [], release: [] };
  let buf = '';
  let proc = null;

  function emit(kind) {
    for (const fn of listeners[kind]) {
      try { fn(); } catch {}
    }
  }

  function edgeToAction(edge) {
    // If activeLow: pressed = falling edge (line pulled low)
    // else: pressed = rising edge
    if (activeLow) return edge === 'falling' ? 'press' : 'release';
    return edge === 'rising' ? 'press' : 'release';
  }

  function spawnProc() {
    buf = '';
    proc = spawn('gpiomon', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    proc.on('error', (err) => {
      // Keep the Node process alive; systemd logs will show the issue.
      console.error('[PocketAgent][gpio] failed to start gpiomon:', err?.message ?? err);
    });

    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const lineText = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!lineText) continue;
        // Output format depends on gpiomon version/flags.
        // If we used -F %e, the line is typically "0" or "1".
        // Otherwise it may contain words like "rising"/"falling".
        const lower = lineText.toLowerCase();

        // Numeric format: 0=failing, 1=rising
        if (lower === '0' || lower === '1') {
          const edge = lower === '0' ? 'falling' : 'rising';
          emit(edgeToAction(edge));
          continue;
        }

        const m = lower.match(/\b(rising|falling)\b/);
        if (!m) continue;
        emit(edgeToAction(m[1]));
      }
    });

    proc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.error('[PocketAgent][gpio] gpiomon:', msg);
    });

    proc.on('exit', (code, signal) => {
      // If gpiomon exits (permission issue, line busy, etc.), retry.
      console.error('[PocketAgent][gpio] gpiomon exited:', { code, signal });
      setTimeout(() => {
        try { spawnProc(); } catch (e) {
          console.error('[PocketAgent][gpio] restart failed:', e?.message ?? e);
        }
      }, 1000);
    });
  }

  console.log('[PocketAgent][gpio] starting gpiomon:', { cmd: 'gpiomon', args });
  spawnProc();

  return {
    onPress(fn) { listeners.press.push(fn); return this; },
    onRelease(fn) { listeners.release.push(fn); return this; },
    stop() { try { proc?.kill('SIGTERM'); } catch {} }
  };
}
