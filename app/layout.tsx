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
				url: '/og.jpg',
				width: 1200,
				height: 630,
				alt: 'Ovrly — панель управления оверлеем для OBS',
			},
		],
	},
	twitter: {
		card: 'summary_large_image',
		title: 'Ovrly — панель управления оверлеем для OBS',
		description,
		images: ['/og.jpg'],
	},
	icons: { icon: '/favicon.svg', apple: '/apple-touch-icon.png' },
	manifest: '/manifest.webmanifest',
	appleWebApp: { capable: true, title: 'Ovrly', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	viewportFit: 'cover',
	themeColor: '#0f0f14',
}

const themeInit = `try{if(localStorage.getItem('theme')==='light')document.documentElement.classList.add('light')}catch(e){}`

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
