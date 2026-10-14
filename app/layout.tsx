import type { Metadata, Viewport } from 'next'
import './globals.css'

// базовый адрес для canonical/OG: на хостинге задайте NEXT_PUBLIC_SITE_URL
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

const description =
	'Панель управления оверлеем OBS: картинки, видео, GIF, сайты, YouTube и Twitch, текст и таймеры — перетаскивание в реальном времени, зона предзагрузки за кадром, управление источниками OBS и доступы для модераторов.'

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
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
	authors: [{ name: 'Ovrly' }],
	creator: 'Ovrly',
	alternates: { canonical: '/' },
	robots: { index: true, follow: true },
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
				url: '/og.png',
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
		images: ['/og.png'],
	},
	icons: { icon: '/favicon.svg', apple: '/favicon.svg' },
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
