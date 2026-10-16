import LogoMark from '@/components/LogoMark'
import { verifySession } from '@/lib/session'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

// Next 16: cookies() и searchParams асинхронные — их нужно дожидаться
export default async function Home({
	searchParams,
}: {
	searchParams?: Promise<{ error?: string }>
}) {
	const session = verifySession((await cookies()).get('sc_session')?.value)
	if (session) redirect('/cabinet')
	const error = (await searchParams)?.error

	// структурированные данные для поиска: что это за приложение
	const jsonLd = {
		'@context': 'https://schema.org',
		'@type': 'SoftwareApplication',
		name: 'Ovrly',
		applicationCategory: 'MultimediaApplication',
		operatingSystem: 'Windows, macOS, Linux (OBS Studio)',
		inLanguage: 'ru',
		description:
			'Панель управления оверлеем OBS: картинки, видео, сайты, YouTube и Twitch, текст и таймеры с перетаскиванием в реальном времени и доступами для модераторов.',
		offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' },
	}

	return (
		<main className='min-h-screen bg-bg flex flex-col items-center justify-center px-4 relative'>
			<script
				type='application/ld+json'
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>
			<div className='flex items-center gap-3 mb-3'>
				<LogoMark size={44} />
				<h1 className='text-2xl font-semibold text-[color:var(--c-on-bg)]'>
					Ovrly
				</h1>
			</div>
			<p className='text-lg text-gray-500 mb-8 text-center'>
				Панель управления оверлеем для модераторов и стримера
			</p>

			{error && (
				<p className='mb-6 max-w-md text-center text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-4 py-3'>
					{error === 'config'
						? 'Вход не настроен: заполните TWITCH_CLIENT_ID и TWITCH_CLIENT_SECRET в .env.local (см. README).'
						: 'Не удалось войти через Twitch. Попробуйте ещё раз.'}
				</p>
			)}

			<a
				href='/api/auth/twitch'
				className='flex items-center gap-3 px-6 py-3.5 rounded-lg text-white font-medium text-base transition-colors bg-[#9146FF] hover:bg-[#772ce8]'
			>
				<svg viewBox='0 0 24 24' fill='#fff' width='22' height='22'>
					<path d='M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714H20.57z' />
				</svg>
				Войти через Twitch
			</a>

			<a
				href='https://dalink.to/jettle_'
				target='_blank'
				rel='noopener noreferrer'
				className='mt-4 inline-flex items-center gap-2 px-6 py-3 rounded-full border border-border bg-panel hover:bg-border text-gray-200 text-sm font-medium transition-all hover:-translate-y-0.5'
			>
				💜 Поддержать проект
			</a>

			<footer className='absolute bottom-5 left-0 right-0 text-center text-xs text-gray-600'>
				<a
					href='https://t.me/ovrly_control'
					target='_blank'
					rel='noopener noreferrer'
					className='text-accent2 hover:underline'
				>
					Telegram
				</a>
				{' новости и тех. поддержка | '}
				<a
					href='https://github.com/qmaximp/stream-control-2'
					target='_blank'
					rel='noopener noreferrer'
					className='text-accent2 hover:underline'
				>
					github
				</a>
				{' проекта | Версия 1.6'}
			</footer>
		</main>
	)
}
