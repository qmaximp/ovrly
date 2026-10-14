// звук окончания обратного таймера: три нарастающих сигнала через Web Audio.
// AudioContext создаётся один раз на страницу и переиспользуется: новый контекст на
// каждый сигнал — это утечка (браузер держит и закрытые контексты, а число
// одновременных ограничено), поэтому контекст больше не закрываем
let ctx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
	try {
		const Ctx =
			window.AudioContext ||
			(window as unknown as { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext
		if (!Ctx) return null
		ctx = ctx ?? new Ctx()
		if (ctx.state === 'suspended') void ctx.resume()
		return ctx
	} catch {
		return null
	}
}

export function playFinishSound() {
	try {
		const audio = getAudioContext()
		if (!audio) return
		const notes = [880, 1174, 880]
		notes.forEach((freq, i) => {
			const t0 = audio.currentTime + i * 0.28
			const osc = audio.createOscillator()
			const gain = audio.createGain()
			osc.type = 'sine'
			osc.frequency.value = freq
			gain.gain.setValueAtTime(0.0001, t0)
			gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.03)
			gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26)
			osc.connect(gain).connect(audio.destination)
			osc.start(t0)
			osc.stop(t0 + 0.3)
		})
	} catch {
		// звук — необязательная часть
	}
}
