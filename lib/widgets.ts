import type {
	WidgetDefinition,
	WidgetVariable,
	WidgetVariableType,
} from './types'

// Имена системных переменных Pogly-совместимого формата. Пользовательские
// переменные не должны с ними пересекаться.
export const WIDGET_RESERVED = new Set([
	'is_overlay',
	'widget_width',
	'widget_height',
	'channel_name',
	'platform',
])

export function isValidWidgetVariableName(name: string): boolean {
	return (
		/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
		!WIDGET_RESERVED.has(name)
	)
}

// Полный набор типов Pogly в том же порядке, что и в их редакторе.
export const WIDGET_VARIABLE_TYPES: WidgetVariableType[] = [
	'string',
	'boolean',
	'toggle',
	'color',
	'media',
	'button',
	'slider',
	'dropdown',
	'datetime',
	'counter',
	'list',
	'checkboxes',
]

// Подписи намеренно английские: так их называют в Pogly и в документации.
export const WIDGET_VARIABLE_LABELS: Record<WidgetVariableType, string> = {
	string: 'String',
	boolean: 'Boolean',
	toggle: 'Toggle',
	color: 'Color',
	media: 'Media',
	button: 'Button',
	slider: 'Slider',
	dropdown: 'Dropdown',
	datetime: 'Date/Time',
	counter: 'Counter',
	list: 'List',
	checkboxes: 'Checkboxes',
}

// Pogly никогда не обновляет toggle и media «на лету»: смена значения
// перезагружает виджет. Кнопка — отдельный триггер, live-флаг ей не нужен.
const NON_LIVE_TYPES = new Set<WidgetVariableType>(['button', 'toggle', 'media'])

export function isNonLiveWidgetType(type: WidgetVariableType): boolean {
	return NON_LIVE_TYPES.has(type)
}

export type WidgetTwitchIntegrationKey =
	| 'twitchChat'
	| 'twitchSubs'
	| 'twitchRaids'
	| 'twitchBits'

export const WIDGET_TWITCH_INTEGRATIONS: {
	key: WidgetTwitchIntegrationKey
	label: string
	callback: string
	hint: string
}[] = [
	{
		key: 'twitchChat',
		label: 'Twitch chat',
		callback: 'onTwitchMessage(data)',
		hint: 'сообщения чата',
	},
	{
		key: 'twitchSubs',
		label: 'Twitch subs',
		callback: 'onTwitchSub(data)',
		hint: 'подписки, ресабы, подарочные сабы',
	},
	{
		key: 'twitchRaids',
		label: 'Twitch raids',
		callback: 'onTwitchRaid(data)',
		hint: 'рейды в канал',
	},
	{
		key: 'twitchBits',
		label: 'Twitch bits',
		callback: 'onTwitchBits(data)',
		hint: 'сообщения с битами',
	},
]

export function widgetHasTwitchIntegration(def: {
	integrations?: WidgetDefinition['integrations']
}): boolean {
	const i = def.integrations
	return !!(i?.twitchChat || i?.twitchSubs || i?.twitchRaids || i?.twitchBits)
}

export function newWidgetId(): string {
	return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function widgetDefaultValues(
	def: WidgetDefinition,
): Record<string, string> {
	const out: Record<string, string> = {}
	for (const v of def.variables || []) out[v.name] = v.value ?? ''
	return out
}

function substitute(text: string, vars: Record<string, string>): string {
	let out = text || ''
	for (const [name, value] of Object.entries(vars)) {
		out = out.split(`{${name}}`).join(value)
	}
	return out
}

export type CompileWidgetOptions = {
	isOverlay?: boolean
	channel?: string | null
	platform?: string
	// фон конкретного экземпляра виджета; ставим после его CSS, чтобы настройка
	// элемента перекрывала фон из кода виджета
	background?: string
	// тёмная шахматка под прозрачным виджетом в редакторе
	preview?: boolean
}

// Собирает четыре файла в один документ. Виджет живёт в sandboxed iframe:
// html/css/js не имеют доступа к панели, а live-переменные приходят сообщением.
export function compileWidget(
	def: WidgetDefinition,
	values: Record<string, string> | undefined,
	opts: CompileWidgetOptions = {},
): string {
	const vars: Record<string, string> = {}
	for (const v of def.variables || []) {
		const raw = values?.[v.name]
		vars[v.name] = String(raw ?? v.value ?? '')
	}
	vars.is_overlay = opts.isOverlay ? 'true' : 'false'
	vars.widget_width = String(def.width || 400)
	vars.widget_height = String(def.height || 200)
	vars.channel_name = opts.channel || ''
	vars.platform = opts.platform || 'twitch'

	const header = substitute(def.header || '', vars)
	const body = substitute(def.body || '', vars)
	const css = substitute(def.style || '', vars)
	const script = substitute(def.script || '', vars)
	const instanceBackground =
		opts.background && opts.background !== 'transparent'
			? `<style>html, body { background: ${opts.background} !important; }</style>`
			: ''
	const previewBackground = opts.preview
		? `<style>html {
  background-color: #0e1017 !important;
  background-image: repeating-conic-gradient(#171a24 0% 25%, #0e1017 0% 50%) !important;
  background-size: 18px 18px !important;
}</style>`
		: ''

	const runtime = `<script>
window.addEventListener('message', function (event) {
  if (event.source !== window.parent) return;
  var data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'widget-vars') {
    if (typeof onLiveVariableUpdate !== 'function') return;
    var vars = data.variables || {};
    for (var name in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, name)) {
        onLiveVariableUpdate(name, vars[name]);
      }
    }
  } else if (data.type === 'widget-trigger') {
    if (typeof onLiveVariableUpdate === 'function') {
      onLiveVariableUpdate(data.name, data.value);
    }
  } else if (data.type === 'widget-chat') {
    if (typeof onTwitchMessage === 'function') onTwitchMessage(data.data);
  } else if (data.type === 'widget-twitch-event') {
    var eventName = data.event;
    if (typeof onTwitchEvent === 'function') onTwitchEvent(eventName, data.data);
    if (eventName === 'sub' && typeof onTwitchSub === 'function') onTwitchSub(data.data);
    if (eventName === 'raid' && typeof onTwitchRaid === 'function') onTwitchRaid(data.data);
    if (eventName === 'bits' && typeof onTwitchBits === 'function') onTwitchBits(data.data);
  }
});
try { parent.postMessage({ type: 'widget-ready' }, '*'); } catch (e) {}
</script>`

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
html { pointer-events: none; color-scheme: normal; }
</style>
${header}
<style>${css}</style>
${instanceBackground}
${previewBackground}
</head>
<body>
${body}
${runtime}
<script>${script}</script>
</body>
</html>`
}

// --- Pogly-совместимый import/export ---
// Pogly хранит типы числами; нам это нужно, чтобы можно было переносить
// готовые виджеты между редакторами.

const TYPE_TO_NUM: Record<WidgetVariableType, number> = {
	string: 1,
	boolean: 2,
	toggle: 3,
	color: 4,
	media: 5,
	button: 6,
	slider: 7,
	dropdown: 8,
	datetime: 9,
	counter: 10,
	list: 11,
	checkboxes: 12,
}
const NUM_TO_TYPE: Record<number, WidgetVariableType> = {
	1: 'string',
	2: 'boolean',
	3: 'toggle',
	4: 'color',
	5: 'media',
	6: 'button',
	7: 'slider',
	8: 'dropdown',
	9: 'datetime',
	10: 'counter',
	11: 'list',
	12: 'checkboxes',
}

function cleanOptions(raw: unknown): string[] | undefined {
	if (!Array.isArray(raw)) return undefined
	const seen = new Set<string>()
	const out: string[] = []
	for (const item of raw.slice(0, 50)) {
		const value = String(item ?? '').trim().slice(0, 100)
		if (!value || seen.has(value)) continue
		seen.add(value)
		out.push(value)
	}
	return out.length ? out : undefined
}

export function toPortableWidget(def: WidgetDefinition) {
	const integrations: Record<string, boolean> = {}
	for (const { key } of WIDGET_TWITCH_INTEGRATIONS) {
		if (def.integrations?.[key]) integrations[key] = true
	}
	return {
		widgetName: def.name,
		widgetWidth: def.width,
		widgetHeight: def.height,
		headerTag: def.header,
		bodyTag: def.body,
		styleTag: def.style,
		scriptTag: def.script,
		...(def.description ? { description: def.description } : {}),
		variables: def.variables.map(v => ({
			variableName: v.name,
			variableType: TYPE_TO_NUM[v.type] ?? 1,
			variableValue: v.value,
			variableLive: !!v.live,
			...(v.min !== undefined ? { variableMin: v.min } : {}),
			...(v.max !== undefined ? { variableMax: v.max } : {}),
			...(v.step !== undefined ? { variableStep: v.step } : {}),
			...(v.options?.length ? { variableOptions: v.options } : {}),
		})),
		...(Object.keys(integrations).length ? { integrations } : {}),
	}
}

function num(v: unknown, fallback: number): number {
	const n = Number(v)
	return Number.isFinite(n) ? n : fallback
}

export function fromPortableWidget(raw: unknown): WidgetDefinition | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, any>
	const name = String(r.widgetName ?? r.name ?? '').trim()
	if (!name) return null
	const width = Math.min(3840, Math.max(20, num(r.widgetWidth ?? r.width, 400)))
	const height = Math.min(2160, Math.max(20, num(r.widgetHeight ?? r.height, 200)))
	const variablesRaw = Array.isArray(r.variables) ? r.variables : []
	const variables: WidgetVariable[] = []
	const seen = new Set<string>()
	for (const item of variablesRaw.slice(0, 50)) {
		if (!item || typeof item !== 'object') continue
		const varName = String(item.variableName ?? item.name ?? '').trim()
		if (!isValidWidgetVariableName(varName) || seen.has(varName)) continue
		const type =
			typeof item.type === 'string' && item.type in TYPE_TO_NUM
				? (item.type as WidgetVariableType)
				: NUM_TO_TYPE[num(item.variableType, 1)] ?? 'string'
		const v: WidgetVariable = {
			name: varName,
			type,
			value: String(item.variableValue ?? item.value ?? ''),
			live: !isNonLiveWidgetType(type) && !!(item.variableLive ?? item.live),
		}
		if (type === 'slider' || type === 'counter') {
			const min = item.variableMin ?? item.min
			const max = item.variableMax ?? item.max
			const step = item.variableStep ?? item.step
			if (min !== undefined) v.min = num(min, 0)
			if (max !== undefined) v.max = num(max, 100)
			if (step !== undefined) v.step = Math.max(0.001, num(step, 1))
		}
		if (type === 'dropdown' || type === 'checkboxes') {
			const options = cleanOptions(item.variableOptions ?? item.options)
			if (options) v.options = options
		}
		seen.add(varName)
		variables.push(v)
	}
	const integrations: Record<string, boolean> = {}
	for (const { key } of WIDGET_TWITCH_INTEGRATIONS) {
		if (r.integrations?.[key]) integrations[key] = true
	}
	return {
		id: typeof r.id === 'string' && r.id ? r.id : newWidgetId(),
		name,
		...(r.description
			? { description: String(r.description).slice(0, 200) }
			: {}),
		width,
		height,
		header: String(r.headerTag ?? r.header ?? ''),
		body: String(r.bodyTag ?? r.body ?? ''),
		style: String(r.styleTag ?? r.style ?? ''),
		script: String(r.scriptTag ?? r.script ?? ''),
		variables,
		integrations: Object.keys(integrations).length
			? (integrations as WidgetDefinition['integrations'])
			: undefined,
	}
}
