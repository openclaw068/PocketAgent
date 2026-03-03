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
  const supportsDebounceP = helpText.includes('--debounce-period') || helpText.includes('-p,');
  const supportsFormatF = helpText.includes(' -F') || helpText.includes('\n-F') || helpText.includes('--format') || helpText.includes('%E');
  const supportsSilentS = helpText.includes(' -s') || helpText.includes('\n-s') || helpText.includes('--silent');

  const args = ['-n'];
  // Some gpiomon builds (older/different libgpiod) don't support -F. If unsupported,
  // we fall back to parsing default output.
  if (supportsFormatF) args.push('-F', '%E');
  if (supportsSilentS) args.push('-s');

  if (supportsDebounceP) args.push('-p', String(debounceMs));
  else args.push('-B', String(debounceMs));

  args.push(gpioChip, String(line));

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
        // Output format depends on gpiomon version/flags. We try to extract an edge token.
        // Common values: "rising" / "falling" or a longer line containing those words.
        const lower = lineText.toLowerCase();
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

  spawnProc();

  return {
    onPress(fn) { listeners.press.push(fn); return this; },
    onRelease(fn) { listeners.release.push(fn); return this; },
    stop() { try { proc?.kill('SIGTERM'); } catch {} }
  };
}
