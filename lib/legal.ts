import type { Metadata } from 'next'

// Единая точка правды для юридических документов.
//
// ⚠️ ФИО и адрес оператора-физлица обязательны по ст. 18.1 ч. 2 п. 3 152-ФЗ.
// Статус самозанятого и ИНН — для реквизитов и оферты; при смене правьте
// только это место — все правовые страницы обновятся сами.
export const OPERATOR = {
	persons: 'jettle_ и nezory_1',
	fullName: 'Солдаткин Максим Олегович',
	// Статус для реквизитов и оферты. Для обычного физлица — пустая строка.
	status:
		'применяющий специальный налоговый режим «Налог на профессиональный доход» (самозанятый)',
	inn: '525821227166',
	address: '603140, г. Нижний Новгород, пл. Комсомольская, д. 2, к. 3, кв. 39',
	email: 'ya@s-maksim.ru',
	telegram: 'https://t.me/ovrly_control',
	telegramLabel: '@ovrly_control',
	site: 'https://ovrly.ru',
	repo: 'https://github.com/qmaximp/ovrly',
	license: 'https://github.com/qmaximp/ovrly/blob/main/LICENSE',
} as const

// Версия входит в cookie согласия и в журнал согласий. Меняйте при любом
// существенном изменении документов — тогда пользователи подтвердят заново.
export const LEGAL_VERSION = '1.1'
export const LEGAL_DATE = '2 ноября 2026 г.'

export const LEGAL_DOCS = [
	{
		href: '/legal/privacy',
		title: 'Политика обработки персональных данных',
		short: 'Политика ПДн',
		desc: 'Какие данные собираем, зачем, кому передаём, сколько храним и как удалить.',
	},
	{
		href: '/legal/terms',
		title: 'Пользовательское соглашение (публичная оферта)',
		short: 'Оферта',
		desc: 'Публичная оферта: правила использования сервиса, права на контент и ответственность сторон.',
	},
	{
		href: '/legal/cookies',
		title: 'Политика использования cookie',
		short: 'Cookie',
		desc: 'Полный список cookie и записей localStorage, сроки хранения и управление.',
	},
	{
		href: '/legal/consent',
		title: 'Согласие на обработку персональных данных',
		short: 'Согласие',
		desc: 'Текст согласия, которое вы даёте при входе через Twitch, и порядок отзыва.',
	},
] as const

export const RKN = {
	address: '109074, г. Москва, Китайгородский проезд, д. 7, стр. 2',
	site: 'https://pd.rkn.gov.ru/',
} as const

// Метаданные правовых страниц: свой canonical/OG/Twitter на каждый документ.
// Без этого Next подставляет OG главной страницы (og:url = «/»), и соцсети
// показывают не тот заголовок.
const OG_IMAGE = {
	url: '/og-v2.jpg',
	width: 1200,
	height: 630,
	alt: 'Ovrly — панель управления оверлеем для OBS',
} as const

export function legalMeta(
	title: string,
	description: string,
	path: string,
): Metadata {
	return {
		title,
		description,
		alternates: { canonical: path },
		openGraph: {
			type: 'website',
			url: path,
			siteName: 'Ovrly',
			locale: 'ru_RU',
			title,
			description,
			images: [OG_IMAGE],
		},
		twitter: {
			card: 'summary_large_image',
			title,
			description,
			images: [OG_IMAGE.url],
		},
	}
}

// Публичное описание оператора для шапки документов.
// Псевдонимы нужны только как fallback, пока ФИО не заполнено.
export function operatorTitle(): string {
	return (
		OPERATOR.fullName ||
		`физические лица — авторы проекта Ovrly: ${OPERATOR.persons}`
	)
}
