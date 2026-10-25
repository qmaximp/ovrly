'use client'

import type { WidgetDefinition } from '@/lib/types'
import { compileWidget, isNonLiveWidgetType } from '@/lib/widgets'
import { useEffect, useMemo, useRef } from 'react'

type Props = {
	widget: WidgetDefinition
	values?: Record<string, string>
	isOverlay?: boolean
	channel?: string | null
	elementId?: string
	background?: string
	preview?: boolean
	className?: string
}

// Виджет живёт в sandboxed iframe без allow-same-origin: его JS не может
// добраться до панели, комнаты или cookie. Всё общение — только postMessage.
export default function WidgetFrame({
	widget,
	values,
	isOverlay = false,
	channel,
	elementId,
	background,
	preview = false,
	className = '',
}: Props) {
	const frameRef = useRef<HTMLIFrameElement | null>(null)
	const liveValues = values || {}
	const valuesRef = useRef(liveValues)
	valuesRef.current = liveValues
	const prevValuesRef = useRef(liveValues)

	// Не-live переменные входят в srcdoc: их изменение перезагружает виджет.
	// Live-переменные в зависимостях не участвуют — они уходят postMessage.
	// Типы, которые Pogly не обновляет на лету, считаем не-live даже в старых
	// сохранённых виджетах, где остался флаг live.
	const nonLiveKey = useMemo(
		() =>
			JSON.stringify(
				(widget.variables || [])
					.filter(v => isNonLiveWidgetType(v.type) || !v.live)
					.map(v => [v.name, liveValues[v.name] ?? v.value ?? '']),
			),
		[widget.variables, liveValues],
	)

	const srcdoc = useMemo(
		() =>
			compileWidget(widget, valuesRef.current, {
				isOverlay,
				channel,
				platform: 'twitch',
				background,
				preview,
			}),
		[
			widget.id,
			widget.header,
			widget.body,
			widget.style,
			widget.script,
			nonLiveKey,
			isOverlay,
			channel,
			background,
			preview,
		],
	)

	useEffect(() => {
		const prev = prevValuesRef.current
		const changed: Record<string, string> = {}
		for (const v of widget.variables || []) {
			if (isNonLiveWidgetType(v.type) || !v.live) continue
			const next = String(liveValues[v.name] ?? v.value ?? '')
			const old = String(prev[v.name] ?? v.value ?? '')
			if (next !== old) changed[v.name] = next
		}
		prevValuesRef.current = liveValues
		if (!Object.keys(changed).length) return
		frameRef.current?.contentWindow?.postMessage(
			{ type: 'widget-vars', variables: changed },
			'*',
		)
	}, [liveValues, widget.variables])

	useEffect(() => {
		if (!elementId) return
		const onTrigger = (e: Event) => {
			const detail = (e as CustomEvent).detail as
				| { id?: string; name?: string; value?: string }
				| undefined
			if (!detail || detail.id !== elementId) return
			frameRef.current?.contentWindow?.postMessage(
				{
					type: 'widget-trigger',
					name: detail.name,
					value: detail.value,
				},
				'*',
			)
		}
		window.addEventListener('ovrly:widget-trigger', onTrigger)
		return () => window.removeEventListener('ovrly:widget-trigger', onTrigger)
	}, [elementId])

	// Twitch-чат комнаты: событие приходит из панели/оверлея и уходит только
	// в виджеты, у которых включена интеграция
	useEffect(() => {
		if (!widget.integrations?.twitchChat) return
		const onChat = (e: Event) => {
			frameRef.current?.contentWindow?.postMessage(
				{ type: 'widget-chat', data: (e as CustomEvent).detail },
				'*',
			)
		}
		window.addEventListener('ovrly:widget-chat', onChat)
		return () => window.removeEventListener('ovrly:widget-chat', onChat)
	}, [widget.integrations?.twitchChat])

	// События Twitch (сабы, рейды, биты): один канал из панели/оверлея,
	// внутри виджета разворачивается в onTwitchSub/onTwitchRaid/onTwitchBits
	useEffect(() => {
		const enabled = widget.integrations
		if (!enabled?.twitchSubs && !enabled?.twitchRaids && !enabled?.twitchBits)
			return
		const onEvent = (e: Event) => {
			const detail = (e as CustomEvent).detail as
				| { event?: string; data?: unknown }
				| undefined
			if (!detail?.event) return
			if (detail.event === 'sub' && !enabled.twitchSubs) return
			if (detail.event === 'raid' && !enabled.twitchRaids) return
			if (detail.event === 'bits' && !enabled.twitchBits) return
			frameRef.current?.contentWindow?.postMessage(
				{
					type: 'widget-twitch-event',
					event: detail.event,
					data: detail.data,
				},
				'*',
			)
		}
		window.addEventListener('ovrly:widget-twitch-event', onEvent)
		return () =>
			window.removeEventListener('ovrly:widget-twitch-event', onEvent)
	}, [
		widget.integrations?.twitchSubs,
		widget.integrations?.twitchRaids,
		widget.integrations?.twitchBits,
	])

	return (
		<iframe
			ref={frameRef}
			title={`Виджеты ${widget.name}`}
			sandbox='allow-scripts'
			allow='autoplay'
			referrerPolicy='no-referrer'
			srcDoc={srcdoc}
			className={`block w-full h-full border-0 ${className}`}
			style={{
				pointerEvents: 'none',
				background: 'transparent',
				// без этого Chrome в тёмной теме рисует непрозрачный белый canvas
				colorScheme: 'normal',
			}}
		/>
	)
}
