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
// serverClockLag считается как «локальные часы минус серверные» (так же, как в
// noteServerClock), поэтому серверное «сейчас» = Date.now() - serverClockLag.ms.
export function syncClock(socket: {
	emit: (event: string, cb: (now: number) => void) => void
}) {
	let best = Infinity
	let lag = 0
	let done = 0
	const probe = () => {
		const t0 = Date.now()
		socket.emit('time:sync', (serverNow: number) => {
			if (typeof serverNow !== 'number') return
			const rtt = Date.now() - t0
			// локальное время в момент ответа сервера (половина RTT назад от сейчас)
			const localAtAnswer = t0 + rtt / 2
			if (rtt < best) {
				best = rtt
				lag = localAtAnswer - serverNow
			}
			if (++done >= 5) {
				// защита от мусора: сдвиг больше 5 минут не применяем
				if (Math.abs(lag) < 5 * 60 * 1000) serverClockLag.ms = Math.round(lag)
			} else {
				setTimeout(probe, 250)
			}
		})
	}
	probe()
}
