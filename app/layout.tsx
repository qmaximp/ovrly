import type { Metadata, Viewport } from 'next'
import './globals.css'
import { siteUrl } from '@/lib/site'

// базовый адрес для canonical/OG: на хостинге задайте NEXT_PUBLIC_SITE_URL
const base = siteUrl()

const description =
	'Панель управления оверлеем OBS: картинки, видео, GIF, сайты, YouTube и Twitch, текст и таймеры — перетаскивание в реальном времени, зона предзагрузки за кадром, управление источниками OBS и доступы для модераторов.'

export const metadata: Metadata = {
	metadataBase: new URL(base),
	title: {
		default: 'Ovrly — панель управления оверлеем для OBS',
		template: '%s · Ovrly',
	},
	description,
	applicationName: 'Ovrly',
	keywords: [
		'OBS',
		'оверлей',
		'панель управления оверлеем',
		'панель модератора',
		'стрим',
		'Twitch',
		'YouTube',
		'overlay',
		'OBS WebSocket',
		'браузер-источник',
	],
	authors: [
		{ name: 'jettle_', url: 'https://www.twitch.tv/jettle_' },
		{ name: 'nezory_1', url: 'https://www.twitch.tv/nezory_1' },
	],
	creator: 'jettle_, nezory_1',
	// подтверждение владения сайтом в Яндекс.Вебмастере (файл-подтверждение
	// тоже лежит в public, но meta-тег работает даже если файл закрыт nginx)
	verification: {
		yandex: 'e0e3796d711d3024',
		// Google Search Console: DNS TXT у REG.RU так и не разошёлся, поэтому
		// подтверждаем мета-тегом (токен публичный, не секрет)
		google: 'MZsoxSyzkByqeUKdZfIvXvhfFwttYxmX0nxb5qUSnOA',
	},
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			'max-image-preview': 'large',
			'max-snippet': -1,
			'max-video-preview': -1,
		},
	},
	openGraph: {
		type: 'website',
		url: '/',
		siteName: 'Ovrly',
		locale: 'ru_RU',
		title: 'Ovrly — панель управления оверлеем для OBS',
		description,
		// статичная картинка (next/og на Windows падает из-за путей в @vercel/og)
		images: [
			{
				url: '/og-v2.jpg',
				width: 1200,
				height: 630,
				type: 'image/jpeg',
				alt: 'Ovrly — панель управления оверлеем для OBS',
			},
		],
	},
	twitter: {
		card: 'summary_large_image',
		title: 'Ovrly — панель управления оверлеем для OBS',
		description,
		images: [
			{
				url: '/og-v2.jpg',
				alt: 'Ovrly — панель управления оверлеем для OBS',
			},
		],
	},
	// svg для современных браузеров, ico — универсальный фолбэк (Safari/старые),
	// png — для браузеров и систем, которые не понимают svg/ico
	icons: {
		icon: [
			{ url: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
			{
				url: '/favicon.ico',
				sizes: '16x16 32x32 48x48 192x192',
				type: 'image/x-icon',
			},
			{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
			{ url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
		],
		shortcut: '/favicon.ico',
		apple: [
			{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
		],
	},
	manifest: '/manifest.webmanifest',
	appleWebApp: { capable: true, title: 'Ovrly', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	viewportFit: 'cover',
	themeColor: '#070b12',
}

const themeInit = `try{if(localStorage.getItem('theme')==='light'){document.documentElement.classList.add('light');document.querySelector('meta[name="theme-color"]')?.setAttribute('content','#f3f0e8')}}catch(e){}`

export default function RootLayout({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<html lang='ru' suppressHydrationWarning>
			<body>
				<script dangerouslySetInnerHTML={{ __html: themeInit }} />
				{children}
			</body>
		</html>
	)
}
