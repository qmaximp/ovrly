import { renderEmail } from '@/lib/emailTemplate'

export const dynamic = 'force-dynamic'

// Просмотр писем в браузере: /dev/mail?kind=register|reset|test
// Только для разработки — в проде маршрут отдаёт 404.
export function GET(req: Request) {
	if (process.env.NODE_ENV === 'production') {
		return new Response('Not found', { status: 404 })
	}

	const kind = new URL(req.url).searchParams.get('kind') || 'register'

	const content =
		kind === 'reset'
			? {
					preheader: 'Код для восстановления доступа',
					kicker: 'Восстановление доступа',
					heading: 'Новый пароль',
					intro:
						'Вы запросили смену пароля в Ovrly. Введите этот код и придумайте новый пароль.',
					code: '574796',
					note: 'Код действует 10 минут. Если вы не запрашивали смену пароля — просто проигнорируйте письмо, старый пароль останется.',
					reason: 'Вы получили письмо, потому что запросили смену пароля на Ovrly.',
				}
			: kind === 'test'
				? {
						preheader: 'Проверка настройки почты',
						kicker: 'Проверка почты',
						heading: 'Почта настроена',
						intro:
							'Это тестовое письмо Ovrly. Если вы его видите — отправка писем работает.',
						note: 'Ничего делать не нужно, письмо можно удалить.',
						reason: 'Тестовое письмо отправлено из админ-панели Ovrly.',
					}
				: {
						preheader: 'Код для регистрации в Ovrly',
						kicker: 'Регистрация',
						heading: 'Подтвердите почту',
						intro:
							'Вы регистрируете аккаунт в Ovrly. Введите этот код в окне регистрации.',
						code: '574796',
						note: 'Код действует 10 минут. Если вы ничего не запрашивали — просто проигнорируйте письмо.',
						reason: 'Вы получили письмо, потому что этот адрес указан при регистрации на Ovrly.',
					}

	const { html } = renderEmail(content)
	return new Response(html, {
		headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
	})
}
