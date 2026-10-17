import type { MetadataRoute } from 'next'

// Веб-манифест: если панель «поставить» на телефон/рабочий стол, она откроется
// как отдельное приложение без адресной строки
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: 'Ovrly — панель управления оверлеем',
		short_name: 'Ovrly',
		description:
			'Управление оверлеем OBS: картинки, видео, сайты, YouTube и Twitch, текст и таймеры.',
		start_url: '/cabinet',
		display: 'standalone',
		background_color: '#0f0f14',
		theme_color: '#0f0f14',
		lang: 'ru',
		icons: [
			{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
			{ src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
			{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
		],
	}
}
