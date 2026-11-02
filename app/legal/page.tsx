import type { Metadata } from 'next'
import Link from 'next/link'
import {
	LEGAL_DATE,
	LEGAL_DOCS,
	LEGAL_VERSION,
	OPERATOR,
	RKN,
	operatorTitle,
} from '@/lib/legal'

export const metadata: Metadata = {
	title: 'Правовая информация',
	description:
		'Документы Ovrly: политика обработки персональных данных, пользовательское соглашение, политика cookie и согласие на обработку данных. Реквизиты оператора и контакты.',
	alternates: { canonical: '/legal' },
	robots: { index: true, follow: true },
}

export default function LegalIndexPage() {
	const site = OPERATOR.site

	return (
		<article className='legal-doc'>
			<p className='legal-kicker'>Ovrly · документы</p>
			<h1>Правовая информация</h1>
			<p className='legal-lead'>
				Здесь собраны документы, которые регулируют использование сайта{' '}
				<a href={site}>{site.replace(/^https?:\/\//, '')}</a> и сервиса Ovrly. Они
				написаны простым языком, но имеют юридическую силу: вход через Twitch и
				использование панели означают, что вы с ними ознакомились и принимаете.
			</p>

			<div className='legal-grid'>
				{LEGAL_DOCS.map(doc => (
					<Link key={doc.href} href={doc.href} className='legal-card'>
						<span className='legal-card-title'>{doc.title}</span>
						<span className='legal-card-desc'>{doc.desc}</span>
						<span className='legal-card-arrow'>Открыть →</span>
					</Link>
				))}
			</div>

			<h2>Кто отвечает за обработку данных</h2>
			<p>
				Оператор персональных данных — {operatorTitle()},{' '}
				{OPERATOR.status}. Это автор проекта Ovrly, который определяет, какие
				данные и зачем обрабатываются.
			</p>
			<dl className='legal-req'>
				<dt>Оператор</dt>
				<dd>{operatorTitle()}</dd>
				{OPERATOR.status && (
					<>
						<dt>Статус</dt>
						<dd>{OPERATOR.status}</dd>
					</>
				)}
				{OPERATOR.inn && (
					<>
						<dt>ИНН</dt>
						<dd>{OPERATOR.inn}</dd>
					</>
				)}
				{OPERATOR.address && (
					<>
						<dt>Адрес для корреспонденции</dt>
						<dd>{OPERATOR.address}</dd>
					</>
				)}
				<dt>Email для обращений</dt>
				<dd>
					<a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a> — основной канал
					для запросов по персональным данным и юридических вопросов.
				</dd>
				<dt>Telegram</dt>
				<dd>
					<a href={OPERATOR.telegram} target='_blank' rel='noopener noreferrer'>
						{OPERATOR.telegramLabel}
					</a>{' '}
					— поддержка и оперативная связь. Для официальных запросов по 152-ФЗ
					используйте email.
				</dd>
				<dt>Сайт</dt>
				<dd>
					<a href={site}>{site}</a>
				</dd>
				<dt>Исходный код</dt>
				<dd>
					<a href={OPERATOR.repo} target='_blank' rel='noopener noreferrer'>
						github.com/qmaximp/ovrly
					</a>{' '}
					— лицензия AGPL-3.0.
				</dd>
				<dt>Редакция</dt>
				<dd>
					{LEGAL_DATE}, версия {LEGAL_VERSION}. Предыдущие редакции предоставляются
					по запросу.
				</dd>
			</dl>

			<h2>Коротко о главном</h2>
			<ul>
				<li>
					<strong>Вход — только через Twitch.</strong> Ovrly не хранит пароли и не
					получает доступ к вашему аккаунту Twitch сверх разрешённых прав.
				</li>
				<li>
					<strong>Сервис бесплатный.</strong> Донаты добровольны и не являются
					оплатой услуг — это поддержка разработки.
				</li>
				<li>
					<strong>Данные не продаются.</strong> Передача возможна только
					техническим партнёрам, перечисленным в Политике, либо по требованию закона.
				</li>
				<li>
					<strong>Cookie только необходимые.</strong> Аналитики, рекламных
					трекеров и сторонних пикселей нет. Полный список — в{' '}
					<Link href='/legal/cookies'>Политике cookie</Link>.
				</li>
				<li>
					<strong>Вы можете удалить данные.</strong> Напишите с логином Twitch на{' '}
					<a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a> — аккаунт и
					контент будут удалены.
				</li>
			</ul>

			<h2>Если что-то пошло не так</h2>
			<p>
				По вопросам обработки персональных данных, удаления аккаунта, нарушения
				ваших прав или уязвимостей в безопасности пишите на{' '}
				<a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>. Мы отвечаем в
				течение 10 рабочих дней (ст. 20 152-ФЗ). Если ответ вас не устроил, вы
				вправе обратиться в Роскомнадзор: {RKN.address},{' '}
				<a href={RKN.site} target='_blank' rel='noopener noreferrer'>
					pd.rkn.gov.ru
				</a>
				, либо в суд.
			</p>

			<div className='legal-note legal-ok'>
				<p>
					<strong>Актуальная версия всегда здесь.</strong> Мы не рассылаем
					документы по почте и не просим подтверждать их по сторонним ссылкам.
					Сверяйте адрес: {site.replace(/^https?:\/\//, '')}/legal.
				</p>
			</div>
		</article>
	)
}
