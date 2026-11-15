// Оценка отставания локальных часов от серверных — чтобы таймер шёл синхронно на всех устройствах.
// Оценка берётся из broadcast'ов element:updated по запущенным таймерам:
// sample = локально_сейчас - startTime(сервер) - elapsed(на момент отправки) ≈ сдвиг часов + латентность.
export const serverClockLag = { ms: 0 };

export function noteServerClock(el: { isRunning?: boolean; startTime?: number | null; elapsed?: number | null }) {
  if (!el.isRunning || !el.startTime) return;
  const sample = Date.now() - el.startTime - (el.elapsed || 0);
  if (sample < 0 || sample > 10000) return;
  serverClockLag.ms = serverClockLag.ms ? Math.round(serverClockLag.ms * 0.6 + sample * 0.4) : sample;
}

// Замер сдвига: 5 проб, берём минимум RTT — он даёт самую честную оценку.
export function syncClock(socket: {
	emit: (event: string, cb: (now: number) => void) => void
}) {
	let best = Infinity
	let lag = 0
	let done = 0
	const probe = () => {
		const t0 = Date.now()
		socket.emit('time:sync', (serverNow: number) => {
			const rtt = Date.now() - t0
			if (rtt < best) {
				best = rtt
				lag = serverNow - t0 - rtt / 2
			}
			if (++done >= 5) {
				serverClockLag.ms = Math.round(lag)
			} else {
				setTimeout(probe, 250)
			}
		})
	}
	probe()
}
