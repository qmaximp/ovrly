'use client'

import type {
	WidgetDefinition,
	WidgetVariable,
	WidgetVariableType,
} from '@/lib/types'
import { WIDGET_TEMPLATES, type WidgetTemplate } from '@/lib/widgetTemplates'
import {
	fromPortableWidget,
	isNonLiveWidgetType,
	isValidWidgetVariableName,
	newWidgetId,
	toPortableWidget,
	WIDGET_TWITCH_INTEGRATIONS,
	WIDGET_VARIABLE_LABELS,
	WIDGET_VARIABLE_TYPES,
	widgetDefaultValues,
	widgetHasTwitchIntegration,
} from '@/lib/widgets'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import CodeMirror from '@uiw/react-codemirror'
import {
	ArrowLeft,
	Blocks,
	Code2,
	Copy,
	Download,
	Globe,
	LayoutGrid,
	Pencil,
	Plus,
	Save,
	Search,
	SlidersHorizontal,
	Trash2,
	Upload,
	X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import WidgetVariableControl from './WidgetControls'
import WidgetFrame from './WidgetFrame'

type Props = {
	widgets: Record<string, WidgetDefinition>
	channel?: string | null
	ownerLogin?: string | null
	theme?: 'dark' | 'light'
	onSave: (def: WidgetDefinition) => void
	onDelete: (id: string) => void
	// из свойств элемента: открыть этот виджет в редакторе и сразу перейти в «Код»
	editWidget?: WidgetDefinition | null
	onEditWidgetDone?: () => void
}

type PublicWidget = {
	id: string
	owner: string
	name: string
	definition: WidgetDefinition
	updatedAt: string
}

const FILE_TABS = [
	['header', 'header.html'],
	['body', 'body.html'],
	['style', 'style.css'],
	['script', 'script.js'],
] as const
type FileKey = (typeof FILE_TABS)[number][0]

const VAR_TYPES: { value: WidgetVariableType; label: string }[] =
	WIDGET_VARIABLE_TYPES.map(value => ({
		value,
		label: WIDGET_VARIABLE_LABELS[value],
	}))

function cloneDef(def: WidgetDefinition, asCopy: boolean): WidgetDefinition {
	return {
		...def,
		id: asCopy ? newWidgetId() : def.id,
		name: asCopy ? `${def.name} (мой)` : def.name,
		variables: def.variables.map(v => ({ ...v })),
		integrations: def.integrations ? { ...def.integrations } : undefined,
	}
}

function blankDef(): WidgetDefinition {
	return {
		id: newWidgetId(),
		name: 'Новый виджет',
		width: 420,
		height: 160,
		header: '',
		body: '<div id="root">{text}</div>',
		style: `html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
}
body {
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: "Segoe UI", system-ui, sans-serif;
}
#root {
  color: #fff;
  font-size: 36px;
  font-weight: 700;
  text-shadow: 0 2px 8px rgba(0,0,0,.6);
}
`,
		script: `var root = document.getElementById('root');
function onLiveVariableUpdate(name, value) {
  if (name === 'text') root.textContent = value;
}
`,
		variables: [{ name: 'text', type: 'string', value: 'Привет', live: true }],
	}
}

type VariableDefaults = {
	value: string
	min?: number
	max?: number
	step?: number
	options?: string[]
}

function defaultForType(type: WidgetVariableType): VariableDefaults {
	switch (type) {
		case 'color':
			return { value: '#ffffff' }
		case 'toggle':
		case 'boolean':
			return { value: 'false' }
		case 'slider':
			return { value: '50', min: 0, max: 100, step: 1 }
		case 'counter':
			return { value: '0', min: 0, max: 100, step: 1 }
		case 'button':
			return { value: 'trigger' }
		case 'dropdown':
			return { value: 'Option 1', options: ['Option 1', 'Option 2'] }
		case 'checkboxes':
			return { value: '', options: ['Option 1', 'Option 2'] }
		default:
			return { value: '' }
	}
}

function prepareWidget(draft: WidgetDefinition): WidgetDefinition {
	return {
		...draft,
		name: draft.name.trim(),
		width: Math.min(3840, Math.max(20, Math.round(draft.width))),
		height: Math.min(2160, Math.max(20, Math.round(draft.height))),
		variables: draft.variables.map(v => {
			const options =
				v.type === 'dropdown' || v.type === 'checkboxes'
					? (v.options || []).map(option => option.trim()).filter(Boolean)
					: undefined
			return {
				...v,
				name: v.name.trim(),
				value: String(v.value ?? ''),
				live: isNonLiveWidgetType(v.type) ? undefined : !!v.live,
				...(options?.length ? { options } : { options: undefined }),
			}
		}),
	}
}

export default function WidgetStudio({
	widgets,
	channel,
	ownerLogin,
	theme = 'dark',
	onSave,
	onDelete,
	editWidget,
	onEditWidgetDone,
}: Props) {
	const [mode, setMode] = useState<'library' | 'editor'>('library')
	const [libraryTab, setLibraryTab] = useState<'templates' | 'mine' | 'public'>(
		'templates',
	)
	const [publicQuery, setPublicQuery] = useState('')
	const [editorTab, setEditorTab] = useState<
		'code' | 'variables' | 'integrations'
	>('code')
	const [draft, setDraft] = useState<WidgetDefinition | null>(null)
	const [draftValues, setDraftValues] = useState<Record<string, string>>({})
	const [activeFile, setActiveFile] = useState<FileKey>('body')
	const [error, setError] = useState('')
	const [status, setStatus] = useState('')
	const [publicWidgets, setPublicWidgets] = useState<PublicWidget[]>([])
	const [publicLoading, setPublicLoading] = useState(false)
	const [publicError, setPublicError] = useState('')
	const [publishing, setPublishing] = useState(false)
	const [jsonOpen, setJsonOpen] = useState<null | 'import' | 'export'>(null)
	const [jsonText, setJsonText] = useState('')
	const [jsonFileName, setJsonFileName] = useState('')
	const [jsonError, setJsonError] = useState('')
	const [preview, setPreview] = useState<{
		def: WidgetDefinition
		values: Record<string, string>
	} | null>(null)

	const userWidgets = useMemo(
		() =>
			Object.values(widgets).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
		[widgets],
	)

	const publicFiltered = useMemo(() => {
		const q = publicQuery.trim().toLowerCase()
		if (!q) return publicWidgets
		return publicWidgets.filter(item => {
			const haystack = [
				item.name,
				item.owner,
				item.definition?.name,
				item.definition?.description,
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
			return haystack.includes(q)
		})
	}, [publicWidgets, publicQuery])

	useEffect(() => {
		if (!draft) return
		const t = setTimeout(() => {
			setPreview({
				def: {
					...draft,
					variables: draft.variables.map(v => ({ ...v })),
				},
				values: { ...draftValues },
			})
		}, 320)
		return () => clearTimeout(t)
	}, [draft, draftValues])

	const openEditor = (def: WidgetDefinition, asCopy = false) => {
		const next = cloneDef(def, asCopy)
		setDraft(next)
		setDraftValues(widgetDefaultValues(next))
		setActiveFile('body')
		setEditorTab('code')
		setError('')
		setStatus('')
		setMode('editor')
	}

	// из свойств элемента: открыть его виджет в редакторе. Если такого id ещё
	// нет в библиотеке комнаты — открываем как копию, чтобы не занять чужой id.
	useEffect(() => {
		if (!editWidget) return
		openEditor(editWidget, !widgets[editWidget.id])
		onEditWidgetDone?.()
	}, [editWidget])

	// «Добавить» на карточке библиотеки: шаблон или публичный виджет становится
	// записью в «Моих виджетах». На холст виджет ставится из панели через
	// мини-окно выбора, поэтому здесь мы не трогаем холст.
	const addToMyWidgets = (def: WidgetDefinition) => {
		if (!widgets[def.id]) onSave(def)
		setLibraryTab('mine')
		setStatus(
			widgets[def.id]
				? 'Этот виджет уже в «Моих виджетах»'
				: 'Добавлено в «Мои виджеты»',
		)
	}

	const openTemplate = (tpl: WidgetTemplate) => openEditor(tpl, true)

	const duplicate = (def: WidgetDefinition) => {
		const copy = cloneDef(def, true)
		copy.name = `${def.name} копия`
		openEditor(copy)
	}

	const closeEditor = () => {
		setMode('library')
		setDraft(null)
		setError('')
		setPreview(null)
	}

	const updateDraft = (patch: Partial<WidgetDefinition>) =>
		setDraft(prev => (prev ? { ...prev, ...patch } : prev))

	const updateVariable = (i: number, patch: Partial<WidgetVariable>) => {
		const current = draft?.variables[i]
		setDraft(prev => {
			if (!prev) return prev
			const variables = prev.variables.map((v, idx) =>
				idx === i ? { ...v, ...patch } : v,
			)
			return { ...prev, variables }
		})
		if (!current) return
		if (patch.name !== undefined || patch.value !== undefined) {
			const name = patch.name ?? current.name
			const value = patch.value ?? current.value
			setDraftValues(prev => {
				const next = { ...prev }
				if (patch.name !== undefined && patch.name !== current.name)
					delete next[current.name]
				next[name] = value
				return next
			})
		}
	}

	const changeVariableType = (i: number, type: WidgetVariableType) => {
		const d = defaultForType(type)
		updateVariable(i, {
			type,
			value: d.value,
			min: d.min,
			max: d.max,
			step: d.step,
			options: d.options,
			live: isNonLiveWidgetType(type) ? undefined : true,
		})
	}

	const addVariable = () => {
		setDraft(prev => {
			if (!prev) return prev
			let n = prev.variables.length + 1
			while (prev.variables.some(v => v.name === `var${n}`)) n++
			return {
				...prev,
				variables: [
					...prev.variables,
					{
						name: `var${n}`,
						type: 'string',
						value: '',
						live: true,
					},
				],
			}
		})
	}

	const removeVariable = (i: number) => {
		setDraft(prev =>
			prev
				? {
						...prev,
						variables: prev.variables.filter((_, idx) => idx !== i),
					}
				: prev,
		)
	}

	const validate = (def: WidgetDefinition): string | null => {
		if (!def.name.trim()) return 'Укажите название виджета.'
		const seen = new Set<string>()
		for (const v of def.variables) {
			if (!isValidWidgetVariableName(v.name))
				return `Некорректное имя переменной «${v.name}». Разрешены латиница, цифры и _, и нельзя использовать системные имена.`
			if (seen.has(v.name)) return `Переменная «${v.name}» объявлена дважды.`
			seen.add(v.name)
		}
		const total =
			def.header.length + def.body.length + def.style.length + def.script.length
		if (total > 240_000) return 'Слишком большой код виджета (лимит 240 КБ).'
		if (def.width < 20 || def.height < 20)
			return 'Размеры виджета должны быть не меньше 20×20.'
		return null
	}

	// «Значения» — это текущие значения переменных в предпросмотре. Перед
	// сохранением/публикацией/экспортом переносим их в definition, иначе правки
	// из блока «Значения» откатываются к значениям шаблона.
	const draftWithValues = (): WidgetDefinition | null => {
		if (!draft) return null
		return {
			...draft,
			variables: draft.variables.map(v => ({
				...v,
				value: String(draftValues[v.name] ?? v.value ?? ''),
			})),
		}
	}

	const save = () => {
		const withValues = draftWithValues()
		if (!withValues) return
		const err = validate(withValues)
		if (err) {
			setError(err)
			return
		}
		onSave(prepareWidget(withValues))
		setStatus('Сохранено')
		setError('')
		setLibraryTab('mine')
		setMode('library')
		setDraft(null)
		setPreview(null)
	}

	const loadPublic = async () => {
		setPublicLoading(true)
		setPublicError('')
		try {
			const res = await fetch('/api/widget-library')
			const j = await res.json()
			if (!res.ok)
				throw new Error(j?.error || 'Не удалось загрузить библиотеку')
			setPublicWidgets(Array.isArray(j.widgets) ? j.widgets : [])
		} catch (e: any) {
			setPublicError(e?.message || 'Не удалось загрузить публичную библиотеку')
		} finally {
			setPublicLoading(false)
		}
	}

	useEffect(() => {
		void loadPublic()
	}, [])

	const publishPublic = async () => {
		const withValues = draftWithValues()
		if (!withValues) return
		const err = validate(withValues)
		if (err) {
			setError(err)
			return
		}
		setPublishing(true)
		setError('')
		try {
			const def = prepareWidget(withValues)
			const res = await fetch('/api/widget-library', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'publish', definition: def }),
			})
			const j = await res.json()
			if (!res.ok) throw new Error(j?.error || 'Не удалось опубликовать виджет')
			onSave(def)
			setStatus('Опубликовано в общей библиотеке')
			setLibraryTab('public')
			await loadPublic()
		} catch (e: any) {
			setError(e?.message || 'Не удалось опубликовать виджет')
		} finally {
			setPublishing(false)
		}
	}

	const unpublishPublic = async (id: string) => {
		if (!confirm('Снять этот виджет с публикации?')) return
		try {
			const res = await fetch('/api/widget-library', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'unpublish', id }),
			})
			const j = await res.json()
			if (!res.ok) throw new Error(j?.error || 'Не удалось снять с публикации')
			await loadPublic()
		} catch (e: any) {
			setPublicError(e?.message || 'Не удалось снять с публикации')
		}
	}

	const openExport = () => {
		const withValues = draftWithValues()
		if (!withValues) return
		setJsonText(
			JSON.stringify(toPortableWidget(prepareWidget(withValues)), null, 2),
		)
		setJsonError('')
		setJsonOpen('export')
	}

	const openImport = () => {
		setJsonText('')
		setJsonFileName('')
		setJsonError('')
		setJsonOpen('import')
	}

	const applyImport = (text: string) => {
		try {
			const parsed = fromPortableWidget(JSON.parse(text))
			if (!parsed) throw new Error('Не удалось разобрать виджет.')
			const imported = { ...parsed, id: newWidgetId() }
			setDraft(imported)
			setDraftValues(widgetDefaultValues(imported))
			setActiveFile('body')
			setEditorTab('code')
			setError('')
			setStatus('')
			setJsonOpen(null)
			setMode('editor')
		} catch (e: any) {
			setJsonError(
				e instanceof SyntaxError
					? 'Некорректный JSON: проверьте файл или вставленный текст.'
					: e?.message || 'Некорректный JSON',
			)
		}
	}

	const doImport = () => applyImport(jsonText)

	// Файл с ПК: читаем текст, показываем его в поле и сразу пробуем открыть
	// редактор. Если JSON битый, модалка остаётся с текстом и ошибкой.
	const importFile = async (file: File | undefined | null) => {
		if (!file) return
		if (file.size > 2 * 1024 * 1024) {
			setJsonError('Файл больше 2 МБ — для виджета это слишком много.')
			return
		}
		try {
			const text = await file.text()
			setJsonText(text)
			setJsonFileName(file.name)
			setJsonError('')
			applyImport(text)
		} catch {
			setJsonError('Не удалось прочитать файл. Выбери .json ещё раз.')
		}
	}

	const copyJson = async () => {
		try {
			await navigator.clipboard.writeText(jsonText)
			setJsonError('Скопировано в буфер обмена ✓')
		} catch {
			setJsonError('Не удалось скопировать — выделите текст вручную.')
		}
	}

	const downloadJson = () => {
		const blob = new Blob([jsonText], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		const base =
			(draft?.name || 'widget')
				.trim()
				.replace(/[^\wа-яё\- ]+/gi, '')
				.replace(/\s+/g, '-')
				.toLowerCase() || 'widget'
		a.href = url
		a.download = `${base}.json`
		document.body.appendChild(a)
		a.click()
		a.remove()
		setTimeout(() => URL.revokeObjectURL(url), 1000)
	}

	if (mode === 'editor' && draft) {
		return (
			<div className='flex-1 min-h-0 flex flex-col bg-bg'>
				<div className='flex items-center gap-2 px-4 py-3 border-b border-border bg-panel shrink-0 flex-wrap'>
					<button
						onClick={closeEditor}
						title='Назад к библиотеке'
						className='w-8 h-8 rounded-lg bg-border hover:bg-gray-600 text-gray-300 flex items-center justify-center shrink-0'
					>
						<ArrowLeft size={16} />
					</button>
					<input
						value={draft.name}
						onChange={e => updateDraft({ name: e.target.value })}
						placeholder='Название виджета'
						aria-label='Название виджета'
						className='min-w-[140px] flex-1 px-3 py-1.5 bg-bg border border-border rounded-lg text-sm font-semibold'
					/>
					<div className='flex items-center h-8 rounded-lg bg-bg border border-border px-1.5 gap-1'>
						<input
							type='number'
							value={draft.width}
							title='Ширина'
							aria-label='Ширина'
							onChange={e =>
								updateDraft({ width: Number(e.target.value) || 0 })
							}
							className='w-14 bg-transparent text-xs text-center text-gray-300 outline-none'
						/>
						<span className='text-[10px] text-gray-600'>×</span>
						<input
							type='number'
							value={draft.height}
							title='Высота'
							aria-label='Высота'
							onChange={e =>
								updateDraft({ height: Number(e.target.value) || 0 })
							}
							className='w-14 bg-transparent text-xs text-center text-gray-300 outline-none'
						/>
					</div>
					<button
						onClick={openImport}
						title='Импорт JSON'
						className='h-8 px-2 rounded-lg bg-border hover:bg-gray-600 text-gray-200 text-xs flex items-center gap-1'
					>
						<Upload size={14} />
						Импорт
					</button>
					<button
						onClick={openExport}
						title='Экспорт JSON'
						className='h-8 px-2 rounded-lg bg-border hover:bg-gray-600 text-gray-200 text-xs flex items-center gap-1'
					>
						<Download size={14} />
						Экспорт
					</button>
					<button
						onClick={publishPublic}
						disabled={publishing}
						title='Опубликовать в общей библиотеке'
						className='h-8 px-2 rounded-lg bg-border hover:bg-gray-600 disabled:opacity-50 text-gray-200 text-xs flex items-center gap-1'
					>
						<Globe size={14} />
						{publishing ? 'Публикую…' : 'Опубликовать'}
					</button>
					<button
						onClick={save}
						className='h-8 px-3 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium flex items-center gap-1.5'
					>
						<Save size={14} />
						Сохранить
					</button>
				</div>
				{error && (
					<p className='px-4 py-2 text-xs text-red-300 bg-red-950/30 border-b border-red-900/40'>
						{error}
					</p>
				)}
				<div className='flex-1 min-h-0 overflow-hidden p-3 sm:p-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]'>
					<div className='min-w-0 min-h-0 flex flex-col gap-3 overflow-y-auto'>
						<div className='flex items-center gap-1 p-1 rounded-xl border border-border bg-panel shrink-0'>
							{(
								[
									['code', 'Код', Code2],
									['variables', 'Переменные', SlidersHorizontal],
									['integrations', 'Интеграции', Globe],
								] as const
							).map(([key, label, Icon]) => (
								<button
									key={key}
									onClick={() => setEditorTab(key)}
									className={`flex-1 h-8 rounded-lg flex items-center justify-center gap-1.5 px-2 text-xs transition-colors ${
										editorTab === key
											? 'bg-accent text-white'
											: 'text-gray-400 hover:bg-border hover:text-gray-200'
									}`}
								>
									<Icon size={14} />
									{label}
									{key === 'variables' && draft.variables.length > 0 && (
										<span className='text-[10px] opacity-70'>
											{draft.variables.length}
										</span>
									)}
									{key === 'integrations' &&
										widgetHasTwitchIntegration(draft) && (
											<span className='w-1.5 h-1.5 rounded-full bg-green-400' />
										)}
								</button>
							))}
						</div>
						{editorTab === 'code' && (
							<div className='rounded-xl border border-border bg-panel overflow-hidden'>
								<div className='flex items-center gap-1 px-2 py-1.5 border-b border-border overflow-x-auto'>
									{FILE_TABS.map(([key, label]) => (
										<button
											key={key}
											onClick={() => setActiveFile(key)}
											className={`px-2.5 py-1 text-xs rounded-lg shrink-0 transition-colors ${
												activeFile === key
													? 'bg-accent text-white'
													: 'text-gray-400 hover:bg-border'
											}`}
										>
											{label}
										</button>
									))}
								</div>
								<div className='text-xs'>
									<CodeMirror
										value={draft[activeFile]}
										height='min(620px, calc(100dvh - 270px))'
										theme={theme}
										extensions={[
											activeFile === 'style'
												? css()
												: activeFile === 'script'
													? javascript()
													: html(),
										]}
										onChange={value => updateDraft({ [activeFile]: value })}
										basicSetup={{
											foldGutter: false,
											highlightActiveLine: true,
											autocompletion: false,
										}}
									/>
								</div>
							</div>
						)}

						{editorTab === 'variables' && (
							<div className='rounded-xl border border-border bg-panel p-3'>
								<div className='flex items-center justify-between mb-2'>
									<h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wide'>
										Переменные
									</h3>
									<button
										onClick={addVariable}
										className='h-7 px-2 rounded-lg bg-border hover:bg-gray-600 text-gray-200 text-[11px] flex items-center gap-1'
									>
										<Plus size={12} />
										Добавить
									</button>
								</div>
								<div className='space-y-2'>
									{draft.variables.map((v, i) => (
										<div
											key={i}
											className='rounded-lg border border-border bg-bg p-2 space-y-2'
										>
											<div className='flex flex-wrap items-center gap-2'>
												<input
													value={v.name}
													onChange={e =>
														updateVariable(i, { name: e.target.value })
													}
													placeholder='имя'
													className='flex-1 min-w-[110px] px-2 py-1 bg-panel border border-border rounded-md text-xs font-mono'
												/>
												<select
													value={v.type}
													onChange={e =>
														changeVariableType(
															i,
															e.target.value as WidgetVariableType,
														)
													}
													className='px-1.5 py-1 bg-panel border border-border rounded-md text-xs'
												>
													{VAR_TYPES.map(t => (
														<option key={t.value} value={t.value}>
															{t.label}
														</option>
													))}
												</select>
												{!isNonLiveWidgetType(v.type) && (
													<label className='flex items-center gap-1 text-[11px] text-gray-400'>
														<input
															type='checkbox'
															checked={!!v.live}
															onChange={e =>
																updateVariable(i, {
																	live: e.target.checked,
																})
															}
														/>
														live
													</label>
												)}
												<button
													onClick={() => removeVariable(i)}
													title='Удалить переменную'
													className='w-7 h-7 rounded-md text-red-400 hover:bg-red-950/40 flex items-center justify-center'
												>
													<Trash2 size={12} />
												</button>
											</div>
											<div className='flex flex-wrap items-center gap-2'>
												<span className='text-[10px] text-gray-500'>
													{v.type === 'button' ? 'Значение' : 'По умолчанию'}
												</span>
												{v.type === 'color' ? (
													<div className='flex gap-1.5 flex-1 min-w-[150px]'>
														<input
															type='color'
															value={
																/^#[0-9a-f]{6}$/i.test(v.value)
																	? v.value
																	: '#ffffff'
															}
															onChange={e =>
																updateVariable(i, {
																	value: e.target.value,
																})
															}
															className='w-8 h-7 rounded bg-panel border border-border'
														/>
														<input
															value={v.value}
															onChange={e =>
																updateVariable(i, {
																	value: e.target.value,
																})
															}
															className='flex-1 min-w-0 px-2 py-1 bg-panel border border-border rounded-md text-xs font-mono'
														/>
													</div>
												) : v.type === 'toggle' || v.type === 'boolean' ? (
													<button
														onClick={() =>
															updateVariable(i, {
																value: v.value === 'true' ? 'false' : 'true',
															})
														}
														className='px-2 py-1 bg-panel border border-border rounded-md text-xs'
													>
														{v.value === 'true' ? 'true' : 'false'}
													</button>
												) : v.type === 'slider' || v.type === 'counter' ? (
													<>
														<input
															type='number'
															value={v.value}
															onChange={e =>
																updateVariable(i, {
																	value: e.target.value,
																})
															}
															className='w-20 px-2 py-1 bg-panel border border-border rounded-md text-xs'
														/>
														<label className='flex items-center gap-1 text-[10px] text-gray-500'>
															min
															<input
																type='number'
																value={v.min ?? 0}
																onChange={e =>
																	updateVariable(i, {
																		min: Number(e.target.value),
																	})
																}
																className='w-14 px-1 py-1 bg-panel border border-border rounded-md text-xs'
															/>
														</label>
														<label className='flex items-center gap-1 text-[10px] text-gray-500'>
															max
															<input
																type='number'
																value={v.max ?? 100}
																onChange={e =>
																	updateVariable(i, {
																		max: Number(e.target.value),
																	})
																}
																className='w-14 px-1 py-1 bg-panel border border-border rounded-md text-xs'
															/>
														</label>
														<label className='flex items-center gap-1 text-[10px] text-gray-500'>
															шаг
															<input
																type='number'
																value={v.step ?? 1}
																onChange={e =>
																	updateVariable(i, {
																		step: Number(e.target.value),
																	})
																}
																className='w-14 px-1 py-1 bg-panel border border-border rounded-md text-xs'
															/>
														</label>
													</>
												) : v.type === 'dropdown' ? (
													(v.options || []).length > 0 ? (
														<select
															value={v.value}
															onChange={e =>
																updateVariable(i, {
																	value: e.target.value,
																})
															}
															className='flex-1 min-w-[140px] px-2 py-1 bg-panel border border-border rounded-md text-xs'
														>
															{(v.options || []).includes(v.value) ? null : (
																<option value={v.value}>
																	{v.value || '—'}
																</option>
															)}
															{(v.options || []).map(option => (
																<option key={option} value={option}>
																	{option}
																</option>
															))}
														</select>
													) : (
														<input
															value={v.value}
															onChange={e =>
																updateVariable(i, {
																	value: e.target.value,
																})
															}
															placeholder='значение'
															className='flex-1 min-w-[110px] px-2 py-1 bg-panel border border-border rounded-md text-xs'
														/>
													)
												) : v.type === 'datetime' ? (
													<input
														type='datetime-local'
														value={
															v.value.includes('T')
																? v.value.slice(0, 16)
																: v.value
														}
														onChange={e =>
															updateVariable(i, {
																value: e.target.value,
															})
														}
														className='flex-1 min-w-[150px] px-2 py-1 bg-panel border border-border rounded-md text-xs'
													/>
												) : v.type === 'list' ? (
													<textarea
														value={v.value}
														onChange={e =>
															updateVariable(i, {
																value: e.target.value,
															})
														}
														rows={3}
														placeholder={'Одна строка — один пункт'}
														className='flex-1 min-w-[160px] px-2 py-1 bg-panel border border-border rounded-md text-xs font-mono resize-y'
													/>
												) : v.type === 'checkboxes' ? (
													(v.options || []).length > 0 ? (
														<div className='flex flex-wrap gap-x-3 gap-y-1 flex-1 min-w-[160px]'>
															{(v.options || []).map(option => {
																const current = v.value
																	.split(',')
																	.map(s => s.trim())
																	.filter(Boolean)
																const selected = current.includes(option)
																return (
																	<label
																		key={option}
																		className='flex items-center gap-1 text-[11px] text-gray-400'
																	>
																		<input
																			type='checkbox'
																			checked={selected}
																			onChange={() => {
																				const next = selected
																					? current.filter(x => x !== option)
																					: [...current, option]
																				updateVariable(i, {
																					value: (v.options || [])
																						.filter(o => next.includes(o))
																						.join(', '),
																				})
																			}}
																		/>
																		{option}
																	</label>
																)
															})}
														</div>
													) : (
														<input
															value={v.value}
															onChange={e =>
																updateVariable(i, {
																	value: e.target.value,
																})
															}
															placeholder='значения через запятую'
															className='flex-1 min-w-[140px] px-2 py-1 bg-panel border border-border rounded-md text-xs'
														/>
													)
												) : v.type === 'media' ? (
													<input
														type='url'
														value={v.value}
														onChange={e =>
															updateVariable(i, {
																value: e.target.value,
															})
														}
														placeholder='https://…'
														className='flex-1 min-w-[150px] px-2 py-1 bg-panel border border-border rounded-md text-xs'
													/>
												) : (
													<input
														value={v.value}
														onChange={e =>
															updateVariable(i, {
																value: e.target.value,
															})
														}
														className='flex-1 min-w-[110px] px-2 py-1 bg-panel border border-border rounded-md text-xs'
													/>
												)}
											</div>
											{(v.type === 'dropdown' || v.type === 'checkboxes') && (
												<label className='block'>
													<span className='text-[10px] text-gray-500'>
														Опции — по одной в строке
													</span>
													<textarea
														value={(v.options || []).join('\n')}
														onChange={e =>
															updateVariable(i, {
																options: e.target.value.split('\n'),
															})
														}
														rows={3}
														placeholder={'Option 1\nOption 2'}
														className='mt-1 w-full px-2 py-1 bg-panel border border-border rounded-md text-xs font-mono resize-y'
													/>
												</label>
											)}
										</div>
									))}
									{!draft.variables.length && (
										<p className='text-[11px] text-gray-600'>
											Переменных пока нет. Они появятся в свойствах элемента на
											холсте.
										</p>
									)}
								</div>
							</div>
						)}

						{editorTab === 'integrations' && (
							<div className='rounded-xl border border-border bg-panel p-3'>
								<h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2'>
									Интеграции
								</h3>
								<div className='space-y-1.5'>
									{WIDGET_TWITCH_INTEGRATIONS.map(item => {
										const on = !!draft.integrations?.[item.key]
										return (
											<button
												key={item.key}
												onClick={() =>
													updateDraft({
														integrations: {
															...draft.integrations,
															[item.key]: !on,
														},
													})
												}
												className='w-full flex items-center justify-between gap-3 px-3 py-2 bg-bg border border-border rounded-lg text-sm'
											>
												<span className='min-w-0 text-left'>
													<span className='block'>{item.label}</span>
													<span className='block text-[10px] leading-relaxed text-gray-500'>
														{item.callback} — {item.hint}
													</span>
												</span>
												<span
													className={`w-9 h-5 rounded-full relative shrink-0 ${on ? 'bg-green-500' : 'bg-gray-600'}`}
												>
													<span
														className='absolute top-[2px] w-4 h-4 bg-white rounded-full transition-all'
														style={{ left: on ? 18 : 2 }}
													/>
												</span>
											</button>
										)
									})}
								</div>
								<p className='mt-1.5 text-[10px] leading-relaxed text-gray-500'>
									Все колбэки необязательны: виджет получит только те события,
									для которых включён переключатель. Kick не поддерживается.
								</p>
							</div>
						)}
					</div>

					<div className='min-w-0 min-h-0 flex flex-col gap-3 overflow-y-auto'>
						<div className='rounded-xl border border-border bg-panel p-3'>
							<div className='flex items-center justify-between mb-2'>
								<h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wide'>
									Предпросмотр
								</h3>
								<span className='text-[10px] text-gray-500 bg-bg border border-border rounded px-1.5 py-0.5'>
									{draft.width}×{draft.height}
								</span>
							</div>
							<div
								className='w-full rounded-lg overflow-hidden border border-border bg-[#0e1017] shadow-inner'
								style={{
									aspectRatio: `${Math.max(1, draft.width)} / ${Math.max(1, draft.height)}`,
								}}
							>
								{preview && (
									<WidgetFrame
										widget={preview.def}
										values={preview.values}
										isOverlay={false}
										channel={channel}
										elementId='__preview__'
										preview
									/>
								)}
							</div>
							<p className='mt-2 text-[10px] text-gray-600'>
								Шахматка показывает прозрачный фон виджета.
							</p>
						</div>
						{draft.variables.length > 0 && (
							<div className='rounded-xl border border-border bg-panel p-3 space-y-3'>
								<div className='flex items-center justify-between'>
									<h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wide'>
										Значения
									</h3>
									<span className='text-[10px] text-gray-600'>
										live — сразу
									</span>
								</div>
								{draft.variables.map(v => (
									<WidgetVariableControl
										key={v.name + v.type}
										variable={v}
										value={draftValues[v.name] ?? v.value ?? ''}
										onChange={value =>
											setDraftValues(prev => ({
												...prev,
												[v.name]: value,
											}))
										}
										onTrigger={() => {
											window.dispatchEvent(
												new CustomEvent('ovrly:widget-trigger', {
													detail: {
														id: '__preview__',
														name: v.name,
														value: v.value,
													},
												}),
											)
										}}
									/>
								))}
							</div>
						)}
						<p className='text-[10px] leading-relaxed text-gray-500 px-1'>
							Виджет работает в sandboxed iframe: его JS не имеет доступа к
							панели и комнате. Live-переменные обновляются без перезагрузки.
						</p>
					</div>
				</div>

				{jsonOpen && (
					<div className='fixed inset-0 z-[80] flex items-center justify-center p-4'>
						<div
							className='absolute inset-0 bg-black/60'
							onClick={() => setJsonOpen(null)}
						/>
						<div className='relative w-full max-w-2xl rounded-2xl border border-border bg-panel p-4 space-y-2'>
							<div className='flex items-center justify-between'>
								<h3 className='text-sm font-semibold'>
									{jsonOpen === 'export' ? 'Экспорт виджета' : 'Импорт виджета'}
								</h3>
								<button
									onClick={() => setJsonOpen(null)}
									className='w-7 h-7 rounded-lg text-gray-400 hover:text-white hover:bg-border flex items-center justify-center'
								>
									<X size={15} />
								</button>
							</div>
							{jsonOpen === 'import' && (
								<label
									onDragOver={e => {
										e.preventDefault()
										e.dataTransfer.dropEffect = 'copy'
									}}
									onDrop={e => {
										e.preventDefault()
										void importFile(e.dataTransfer.files?.[0])
									}}
									className='flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-bg/60 px-4 py-4 text-center transition-colors hover:border-accent2/60 hover:bg-bg'
								>
									<Upload size={18} className='text-gray-400' />
									<span className='text-xs text-gray-300'>
										Перетащи .json сюда или выбери файл
									</span>
									<span className='text-[10px] text-gray-500'>
										До 2 МБ — JSON из Pogly или сохранённый кнопкой «Скачать
										JSON»
									</span>
									<input
										type='file'
										accept='.json,application/json'
										className='hidden'
										onChange={e => {
											const file = e.target.files?.[0]
											e.target.value = ''
											void importFile(file)
										}}
									/>
								</label>
							)}
							{jsonFileName && (
								<p className='text-[10px] text-gray-400'>
									Файл: <span className='text-gray-300'>{jsonFileName}</span>
								</p>
							)}
							<textarea
								value={jsonText}
								onChange={e => setJsonText(e.target.value)}
								readOnly={jsonOpen === 'export'}
								rows={14}
								spellCheck={false}
								placeholder='…или вставь JSON сюда'
								className='w-full px-3 py-2 bg-bg border border-border rounded-lg text-[11px] font-mono leading-relaxed'
							/>
							{jsonError && (
								<p className='text-xs text-gray-400'>{jsonError}</p>
							)}
							<div className='flex gap-2'>
								{jsonOpen === 'export' ? (
									<>
										<button
											onClick={copyJson}
											className='flex-1 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg'
										>
											Копировать
										</button>
										<button
											onClick={downloadJson}
											className='flex-1 px-3 py-2 bg-border hover:bg-gray-600 text-white text-sm rounded-lg flex items-center justify-center gap-1.5'
										>
											<Download size={15} />
											Скачать JSON
										</button>
									</>
								) : (
									<button
										onClick={doImport}
										className='flex-1 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg'
									>
										Загрузить
									</button>
								)}
								<button
									onClick={() => setJsonOpen(null)}
									className='px-3 py-2 bg-border hover:bg-gray-600 text-white text-sm rounded-lg'
								>
									Закрыть
								</button>
							</div>
						</div>
					</div>
				)}
			</div>
		)
	}

	return (
		<div className='flex-1 min-h-0 overflow-y-auto bg-bg'>
			<div className='max-w-6xl mx-auto p-4 sm:p-6'>
				<div className='flex items-start gap-3 flex-wrap mb-5'>
					<span className='w-10 h-10 rounded-xl bg-accent/15 text-accent2 flex items-center justify-center shrink-0'>
						<Blocks size={20} />
					</span>
					<div className='min-w-0 flex-1'>
						<h2 className='text-lg font-semibold text-[color:var(--c-on-bg)]'>
							Виджеты
						</h2>
						<p className='text-sm text-gray-500 mt-0.5'>
							Готовые шаблоны и свои виджеты на HTML/CSS/JS. Виджет
							отрисовывается в изолированном iframe и на холсте, и в оверлее.
						</p>
					</div>
					<button
						onClick={() => openEditor(blankDef())}
						className='h-9 px-3 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm flex items-center gap-1.5 shrink-0'
					>
						<Plus size={15} />
						Создать виджет
					</button>
				</div>

				{status && (
					<p className='mb-4 rounded-lg border border-green-900/50 bg-green-950/20 px-3 py-2 text-xs text-green-400'>
						{status}
					</p>
				)}

				<div className='flex gap-1 p-1 rounded-xl border border-border bg-panel mb-4 overflow-x-auto'>
					{(
						[
							['templates', 'Готовые шаблоны', WIDGET_TEMPLATES.length],
							['mine', 'Мои виджеты', userWidgets.length],
							['public', 'Публичная библиотека', publicWidgets.length],
						] as const
					).map(([key, label, count]) => (
						<button
							key={key}
							onClick={() => setLibraryTab(key)}
							className={`h-9 px-3 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors ${
								libraryTab === key
									? 'bg-accent text-white'
									: 'text-gray-400 hover:bg-border hover:text-gray-200'
							}`}
						>
							{label}
							<span
								className={`text-[10px] rounded px-1 ${libraryTab === key ? 'bg-white/15' : 'bg-bg text-gray-500'}`}
							>
								{key === 'public' && publicLoading ? '…' : count}
							</span>
						</button>
					))}
				</div>

				{libraryTab === 'templates' && (
					<div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
						{WIDGET_TEMPLATES.map(tpl => (
							<WidgetCard
								key={tpl.id}
								def={tpl}
								description={tpl.description}
								onAdd={() => addToMyWidgets(tpl)}
								onEdit={() => openTemplate(tpl)}
							/>
						))}
					</div>
				)}

				{libraryTab === 'mine' &&
					(userWidgets.length ? (
						<div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
							{userWidgets.map(def => (
								<WidgetCard
									key={def.id}
									def={def}
									description={def.description || 'Ваш виджет'}
									onEdit={() => openEditor(def)}
									onDuplicate={() => duplicate(def)}
									onDelete={() => {
										if (confirm(`Удалить виджет «${def.name}» из библиотеки?`))
											onDelete(def.id)
									}}
								/>
							))}
						</div>
					) : (
						<div className='rounded-2xl border border-dashed border-border bg-panel/50 p-5 text-sm text-gray-500'>
							Пока нет своих виджетов. Создайте с нуля или возьмите готовый
							шаблон и сохраните как свой.
						</div>
					))}

				{libraryTab === 'public' && (
					<>
						<div className='flex items-center gap-2 mb-3 flex-wrap'>
							<div className='relative flex-1 min-w-[220px]'>
								<Search
									size={15}
									className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none'
								/>
								<input
									value={publicQuery}
									onChange={e => setPublicQuery(e.target.value)}
									placeholder='Поиск по названию, автору или описанию…'
									aria-label='Поиск в публичной библиотеке'
									className='w-full h-9 pl-9 pr-8 bg-panel border border-border rounded-lg text-sm'
								/>
								{publicQuery && (
									<button
										onClick={() => setPublicQuery('')}
										title='Очистить поиск'
										className='absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-gray-500 hover:text-white hover:bg-border flex items-center justify-center'
									>
										<X size={13} />
									</button>
								)}
							</div>
							<span className='text-xs text-gray-500'>
								{publicQuery
									? `Найдено: ${publicFiltered.length}`
									: `Всего: ${publicWidgets.length}`}
							</span>
						</div>
						{publicLoading ? (
							<p className='text-sm text-gray-500'>
								Загружаю публичную библиотеку…
							</p>
						) : publicError ? (
							<div className='rounded-2xl border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-300'>
								{publicError}
								<button
									onClick={() => void loadPublic()}
									className='ml-2 underline hover:no-underline'
								>
									Повторить
								</button>
							</div>
						) : publicFiltered.length ? (
							<div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
								{publicFiltered.map(item => (
									<PublicWidgetCard
										key={item.id}
										item={item}
										own={
											!!ownerLogin &&
											item.owner.toLowerCase() === ownerLogin.toLowerCase()
										}
										onAdd={() => addToMyWidgets(item.definition)}
										onEdit={() => openEditor(item.definition, true)}
										onUnpublish={() => void unpublishPublic(item.id)}
									/>
								))}
							</div>
						) : (
							<div className='rounded-2xl border border-dashed border-border bg-panel/50 p-5 text-sm text-gray-500'>
								{publicQuery
									? `Ничего не найдено по запросу «${publicQuery}».`
									: 'В публичной библиотеке пока пусто. Опубликуйте свой виджет кнопкой «Опубликовать» в редакторе.'}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	)
}

function WidgetCard({
	def,
	description,
	onAdd,
	onEdit,
	onDuplicate,
	onDelete,
}: {
	def: WidgetDefinition
	description: string
	onAdd?: () => void
	onEdit: () => void
	onDuplicate?: () => void
	onDelete?: () => void
}) {
	return (
		<div className='rounded-2xl border border-border bg-panel p-4 flex flex-col gap-2'>
			<div className='flex items-start gap-2'>
				<span className='w-8 h-8 rounded-lg bg-bg border border-border text-accent2 flex items-center justify-center shrink-0'>
					<LayoutGrid size={15} />
				</span>
				<div className='min-w-0 flex-1'>
					<div className='flex items-center gap-2'>
						<h4 className='text-sm font-semibold text-[color:var(--c-on-bg)] truncate'>
							{def.name}
						</h4>
						<span className='text-[10px] text-gray-500 bg-bg border border-border rounded px-1.5 py-0.5 shrink-0'>
							{def.width}×{def.height}
						</span>
						{widgetHasTwitchIntegration(def) && (
							<span className='text-[10px] text-purple-300 bg-purple-950/40 border border-purple-900/50 rounded px-1.5 py-0.5 shrink-0'>
								Twitch
							</span>
						)}
					</div>
					<p className='mt-0.5 text-xs leading-relaxed text-gray-500 line-clamp-2'>
						{description}
					</p>
				</div>
			</div>
			<div className='mt-auto flex items-center gap-1.5 pt-1'>
				{onAdd && (
					<button
						onClick={onAdd}
						className='flex-1 h-8 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium'
					>
						Добавить
					</button>
				)}
				<button
					onClick={onEdit}
					title='Открыть в редакторе'
					className='w-8 h-8 rounded-lg bg-border hover:bg-gray-600 text-gray-300 flex items-center justify-center'
				>
					<Pencil size={13} />
				</button>
				{onDuplicate && (
					<button
						onClick={onDuplicate}
						title='Дублировать'
						className='w-8 h-8 rounded-lg bg-border hover:bg-gray-600 text-gray-300 flex items-center justify-center'
					>
						<Copy size={13} />
					</button>
				)}
				{onDelete && (
					<button
						onClick={onDelete}
						title='Удалить из библиотеки'
						className='w-8 h-8 rounded-lg text-red-400 hover:bg-red-950/40 flex items-center justify-center'
					>
						<Trash2 size={13} />
					</button>
				)}
			</div>
		</div>
	)
}

function PublicWidgetCard({
	item,
	own,
	onAdd,
	onEdit,
	onUnpublish,
}: {
	item: PublicWidget
	own: boolean
	onAdd: () => void
	onEdit: () => void
	onUnpublish: () => void
}) {
	const def = item.definition
	return (
		<div className='rounded-2xl border border-border bg-panel p-4 flex flex-col gap-2'>
			<div className='flex items-start gap-2'>
				<span className='w-8 h-8 rounded-lg bg-bg border border-border text-accent2 flex items-center justify-center shrink-0'>
					<Globe size={15} />
				</span>
				<div className='min-w-0 flex-1'>
					<div className='flex items-center gap-2'>
						<h4 className='text-sm font-semibold text-[color:var(--c-on-bg)] truncate'>
							{def.name || item.name}
						</h4>
						<span className='text-[10px] text-gray-500 bg-bg border border-border rounded px-1.5 py-0.5 shrink-0'>
							{def.width}×{def.height}
						</span>
						{widgetHasTwitchIntegration(def) && (
							<span className='text-[10px] text-purple-300 bg-purple-950/40 border border-purple-900/50 rounded px-1.5 py-0.5 shrink-0'>
								Twitch
							</span>
						)}
					</div>
					<p className='mt-0.5 text-[11px] text-gray-500 truncate'>
						@{item.owner}
					</p>
					<p className='mt-0.5 text-xs leading-relaxed text-gray-500 line-clamp-2'>
						{def.description || 'Виджеты сообщества'}
					</p>
				</div>
			</div>
			<div className='mt-auto flex items-center gap-1.5 pt-1'>
				<button
					onClick={onAdd}
					className='flex-1 h-8 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium'
				>
					Добавить
				</button>
				<button
					onClick={onEdit}
					title='Открыть копию в редакторе'
					className='w-8 h-8 rounded-lg bg-border hover:bg-gray-600 text-gray-300 flex items-center justify-center'
				>
					<Pencil size={13} />
				</button>
				{own && (
					<button
						onClick={onUnpublish}
						title='Снять с публикации'
						className='w-8 h-8 rounded-lg text-red-400 hover:bg-red-950/40 flex items-center justify-center'
					>
						<Trash2 size={13} />
					</button>
				)}
			</div>
		</div>
	)
}
