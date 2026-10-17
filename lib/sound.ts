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

// Звук окончания таймера: свой файл (data-URL с ПК) или встроенный сигнал.
// Играется выбранный в панели фрагмент: start — смещение от начала файла,
// duration — длина фрагмента. Длительность ограничена 10 секундами, чтобы
// случайно не залить эфир длинным треком
export type TimerSoundOpts = {
	src?: string
	volume?: number
	duration?: number
	start?: number
}

// текущее воспроизведение: повторный сигнал не накладывается на предыдущий
let currentSound: HTMLAudioElement | null = null
let stopCurrent: (() => void) | null = null

function stopTimerSound() {
	const stop = stopCurrent
	stopCurrent = null
	if (stop) stop()
}

export function playTimerSound(opts: TimerSoundOpts = {}) {
	stopTimerSound()
	if (!opts.src) {
		playFinishSound()
		return
	}
	try {
		const audio = new Audio(opts.src)
		audio.volume = Math.min(1, Math.max(0, opts.volume ?? 1))
		currentSound = audio
		const startAt = Math.max(0, opts.start ?? 0)
		const seconds = Math.max(0.2, Math.min(opts.duration ?? 10, 10))
		const endAt = startAt + seconds
		let timer: ReturnType<typeof setTimeout> | null = null

		const cleanup = () => {
			if (timer !== null) {
				clearTimeout(timer)
				timer = null
			}
			audio.removeEventListener('timeupdate', onTime)
			try {
				audio.pause()
			} catch {}
			if (currentSound === audio) currentSound = null
			if (stopCurrent === stop) stopCurrent = null
		}
		const stop = () => cleanup()
		const onTime = () => {
			try {
				if (audio.currentTime >= endAt - 0.02) stop()
			} catch {}
		}
		stopCurrent = stop

		const begin = () => {
			try {
				audio.currentTime = startAt
			} catch {}
			void audio.play().catch(() => {})
			audio.addEventListener('timeupdate', onTime)
			// timeupdate приходит не у всех форматов достаточно часто — страхуемся таймером
			timer = setTimeout(stop, seconds * 1000 + 400)
		}
		audio.addEventListener(
			'error',
			() => {
				cleanup()
			},
			{ once: true },
		)
		// currentTime до загрузки метаданных не применяется: ждём loadedmetadata
		if (audio.readyState >= 1) begin()
		else audio.addEventListener('loadedmetadata', begin, { once: true })
	} catch {}
}

// Волна для выбора фрагмента: декодируем файл и считаем пики по корзинам.
// Возвращаем длительность файла и массив амплитуд 0..1 для отрисовки
export type SoundAnalysis = {
	duration: number
	peaks: number[]
}

// data-URL разбираем сами: fetch(data:) поддерживается не везде (в некоторых
// встроенных браузерах он падает с «Failed to fetch»), а atob есть всегда
function dataUrlToBuffer(src: string): ArrayBuffer {
	const comma = src.indexOf(',')
	if (comma < 0) throw new Error('Некорректный data-URL')
	const meta = src.slice(0, comma)
	const body = src.slice(comma + 1)
	if (!/;base64/i.test(meta)) {
		const bytes = new TextEncoder().encode(decodeURIComponent(body))
		return bytes.buffer.slice(0) as ArrayBuffer
	}
	const bin = atob(body.replace(/\s+/g, ''))
	const bytes = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
	return bytes.buffer
}

export async function analyzeSound(
	src: string,
	buckets = 160,
): Promise<SoundAnalysis> {
	const audio = getAudioContext()
	if (!audio) throw new Error('AudioContext недоступен')
	let buf: ArrayBuffer
	if (src.startsWith('data:')) {
		buf = dataUrlToBuffer(src)
	} else {
		const res = await fetch(src)
		if (!res.ok) throw new Error('Не удалось прочитать файл')
		buf = await res.arrayBuffer()
	}
	// копия буфера: некоторые браузеры «отсоединяют» переданный ArrayBuffer
	const decoded = await audio.decodeAudioData(buf.slice(0))
	const channel = decoded.getChannelData(0)
	const count = Math.max(8, Math.min(buckets, channel.length || buckets))
	const step = Math.max(1, Math.floor(channel.length / count))
	const peaks: number[] = []
	let max = 0
	for (let i = 0; i < count; i++) {
		const from = i * step
		const to =
			i === count - 1
				? channel.length
				: Math.min(channel.length, from + step)
		let peak = 0
		// длинные файлы не перебираем целиком: для картинки достаточно прореживания
		const stride = Math.max(1, Math.floor((to - from) / 1000))
		for (let j = from; j < to; j += stride) {
			const v = Math.abs(channel[j])
			if (v > peak) peak = v
		}
		peaks.push(peak)
		if (peak > max) max = peak
	}
	const k = max > 1e-4 ? 1 / max : 0
	return {
		duration: decoded.duration,
		peaks: peaks.map(p => Math.min(1, p * k)),
	}
}
