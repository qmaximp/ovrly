const isDev = process.env.NODE_ENV !== 'production'

// CSP: приложение само встраивает сторонние сайты (YouTube, Twitch, «Сайт»-элементы),
// поэтому frame-src открыт, а скрипты — только свои и плееров Twitch.
// 'unsafe-inline' нужен Next для бутстрап-скриптов и стилей (у элементов оверлея
// много инлайновых style), 'unsafe-eval' — только в dev (webpack HMR).
const csp = [
	"default-src 'self'",
	isDev
		? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://embed.twitch.tv https://player.twitch.tv"
		: "script-src 'self' 'unsafe-inline' https://embed.twitch.tv https://player.twitch.tv",
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
	"font-src 'self' data: https://fonts.gstatic.com",
	// картинки/медиа: свои, файлы с ПК (data:/blob:) и любые https-ссылки
	"img-src 'self' data: blob: https:",
	"media-src 'self' data: blob: https:",
	// встраиваемые сайты, YouTube и плееры Twitch
	'frame-src *',
	// сокеты и внешние API (Twitch helix, ivr.fi и т.п.)
	"connect-src 'self' ws: wss: https:",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	// страницы нельзя встраивать в чужие сайты (оверлей в OBS грузится как отдельная
	// страница, а не как iframe, поэтому ограничение ему не мешает)
	"frame-ancestors 'self'",
].join('; ')

const securityHeaders = [
	{ key: 'Content-Security-Policy', value: csp },
	{ key: 'X-Content-Type-Options', value: 'nosniff' },
	{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
	{ key: 'X-Frame-Options', value: 'SAMEORIGIN' },
	{ key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
	{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	// не светим, что проект на Next
	poweredByHeader: false,
	// В dev Next блокирует HMR/служебные запросы с чужих origin. Разработчики
	// открывают панель и по localhost, и по 127.0.0.1 — разрешаем оба.
	allowedDevOrigins: ['127.0.0.1', 'localhost'],
	async headers() {
		return [{ source: '/:path*', headers: securityHeaders }]
	},
}

module.exports = nextConfig
