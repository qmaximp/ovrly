import type { WidgetDefinition } from './types'

export type WidgetTemplate = WidgetDefinition & { description: string }

const baseStyle = `html, body {
  margin: 0;
  padding: 0;
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
`

export const WIDGET_TEMPLATES: WidgetTemplate[] = [
	{
		id: 'tpl-clock',
		name: 'Часы',
		description: 'Текущее время, обновляется каждую секунду.',
		width: 300,
		height: 100,
		header: '',
		body: '<div id="clock"></div>',
		style: `${baseStyle}
#clock {
  color: {color};
  font-size: {size}px;
  font-weight: 800;
  letter-spacing: 1px;
  text-shadow: 0 2px 8px rgba(0,0,0,.6);
}
`,
		script: `var clock = document.getElementById('clock');
function tick() {
  clock.textContent = new Date().toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}
tick();
setInterval(tick, 1000);
function onLiveVariableUpdate(name, value) {
  if (name === 'color') clock.style.color = value;
  if (name === 'size') clock.style.fontSize = value + 'px';
}
`,
		variables: [
			{ name: 'color', type: 'color', value: '#ffffff', live: true },
			{
				name: 'size',
				type: 'slider',
				value: '64',
				live: true,
				min: 24,
				max: 160,
				step: 4,
			},
		],
	},
	{
		id: 'tpl-text',
		name: 'Текст',
		description: 'Строка текста с цветом и размером.',
		width: 420,
		height: 90,
		header: '',
		body: '<div id="text">{text}</div>',
		style: `${baseStyle}
#text {
  max-width: 100%;
  padding: 0 10px;
  color: {color};
  font-size: {size}px;
  font-weight: 700;
  text-align: center;
  line-height: 1.15;
  text-shadow: 0 2px 8px rgba(0,0,0,.6);
  overflow: hidden;
}
`,
		script: `var text = document.getElementById('text');
function onLiveVariableUpdate(name, value) {
  if (name === 'text') text.textContent = value;
  if (name === 'color') text.style.color = value;
  if (name === 'size') text.style.fontSize = value + 'px';
}
`,
		variables: [
			{ name: 'text', type: 'string', value: 'Привет', live: true },
			{ name: 'color', type: 'color', value: '#ffffff', live: true },
			{
				name: 'size',
				type: 'slider',
				value: '36',
				live: true,
				min: 12,
				max: 160,
				step: 2,
			},
		],
	},
	{
		id: 'tpl-counter',
		name: 'Счётчик',
		description: 'Большое число с подписью и кнопками изменения.',
		width: 260,
		height: 150,
		header: '',
		body: '<div id="wrap"><span id="count">{count}</span><span id="caption">{caption}</span></div>',
		style: `${baseStyle}
body { background: transparent; }
#wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 100%;
  height: 100%;
  color: {color};
  text-shadow: 0 2px 8px rgba(0,0,0,.6);
}
#count { font-size: 72px; font-weight: 800; line-height: 1; }
#caption {
  font-size: 15px;
  letter-spacing: .08em;
  text-transform: uppercase;
  opacity: .75;
}
`,
		script: `var count = document.getElementById('count');
var caption = document.getElementById('caption');
var wrap = document.getElementById('wrap');
function onLiveVariableUpdate(name, value) {
  if (name === 'count') count.textContent = value;
  if (name === 'caption') caption.textContent = value;
  if (name === 'color') wrap.style.color = value;
}
`,
		variables: [
			{
				name: 'count',
				type: 'counter',
				value: '0',
				live: true,
				min: 0,
			},
			{ name: 'caption', type: 'string', value: 'Счёт', live: true },
			{ name: 'color', type: 'color', value: '#ffffff', live: true },
		],
	},
	{
		id: 'tpl-progress',
		name: 'Прогресс',
		description: 'Полоска прогресса с подписью и процентом.',
		width: 460,
		height: 110,
		header: '',
		body: '<div id="wrap"><div id="label">{label}</div><div id="track"><div id="bar" style="width: {value}%"></div></div><div id="value">{value}%</div></div>',
		style: `${baseStyle}
body { background: transparent; }
#wrap {
  width: 100%;
  padding: 0 14px;
  color: #ffffff;
  text-shadow: 0 2px 8px rgba(0,0,0,.6);
  box-sizing: border-box;
}
#label {
  margin-bottom: 6px;
  font-size: 15px;
  letter-spacing: .06em;
  text-transform: uppercase;
}
#track {
  height: 18px;
  border-radius: 999px;
  background: rgba(255,255,255,.18);
  overflow: hidden;
}
#bar {
  height: 100%;
  border-radius: 999px;
  background: {color};
  transition: width .25s ease;
}
#value {
  margin-top: 5px;
  font-size: 13px;
  opacity: .8;
}
`,
		script: `var bar = document.getElementById('bar');
var label = document.getElementById('label');
var value = document.getElementById('value');
function onLiveVariableUpdate(name, v) {
  if (name === 'value') {
    bar.style.width = v + '%';
    value.textContent = v + '%';
  }
  if (name === 'label') label.textContent = v;
  if (name === 'color') bar.style.background = v;
}
`,
		variables: [
			{
				name: 'value',
				type: 'slider',
				value: '40',
				live: true,
				min: 0,
				max: 100,
				step: 1,
			},
			{ name: 'label', type: 'string', value: 'Цель', live: true },
			{ name: 'color', type: 'color', value: '#38bdf8', live: true },
		],
	},
	{
		id: 'tpl-chat',
		name: 'Чат Twitch',
		description: 'Последние сообщения чата канала. Включает интеграцию Twitch.',
		width: 380,
		height: 340,
		header: '',
		body: '<div id="title">{title}</div><div id="list"></div>',
		style: `${baseStyle}
body {
  display: block;
  box-sizing: border-box;
  padding: 10px;
  color: {color};
  background: rgba(12, 16, 26, .72);
  border-radius: 12px;
}
#title {
  margin-bottom: 8px;
  font-size: 13px;
  letter-spacing: .08em;
  text-transform: uppercase;
  opacity: .7;
}
#list { display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
.row {
  display: flex;
  gap: 6px;
  font-size: 14px;
  line-height: 1.25;
  text-shadow: 0 1px 3px rgba(0,0,0,.7);
}
.name { font-weight: 700; flex-shrink: 0; }
.text { min-width: 0; overflow-wrap: anywhere; }
`,
		script: `var list = document.getElementById('list');
var title = document.getElementById('title');
function onTwitchMessage(data) {
  var row = document.createElement('div');
  row.className = 'row';
  var name = document.createElement('span');
  name.className = 'name';
  name.textContent = data.username || '';
  if (data.color) name.style.color = data.color;
  var text = document.createElement('span');
  text.className = 'text';
  text.textContent = (data.isAction ? '* ' : '') + (data.message || '');
  row.appendChild(name);
  row.appendChild(text);
  list.appendChild(row);
  while (list.children.length > 12) list.removeChild(list.firstChild);
}
function onLiveVariableUpdate(name, value) {
  if (name === 'title') title.textContent = value;
  if (name === 'color') document.body.style.color = value;
}
`,
		variables: [
			{ name: 'title', type: 'string', value: 'Чат', live: true },
			{ name: 'color', type: 'color', value: '#ffffff', live: true },
		],
		integrations: { twitchChat: true },
	},
	{
		id: 'tpl-twitch-alert',
		name: 'Twitch алерт',
		description:
			'Подписки, подарочные сабы, рейды и биты. Включает Twitch subs, raids и bits.',
		width: 520,
		height: 140,
		header: '',
		body: '<div id="banner"><div id="title"></div><div id="sub"></div></div>',
		style: `${baseStyle}
#banner {
  min-width: 260px;
  max-width: 90%;
  box-sizing: border-box;
  padding: 14px 22px;
  border-radius: 14px;
  background: rgba(15, 18, 28, .92);
  border: 2px solid {color};
  color: {color};
  text-align: center;
  box-shadow: 0 8px 30px rgba(0,0,0,.45);
  transform: translateY(-24px);
  opacity: 0;
  transition: transform .25s ease, opacity .25s ease;
}
#banner.show { transform: translateY(0); opacity: 1; }
#title {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: .06em;
}
#sub {
  margin-top: 4px;
  font-size: 15px;
  opacity: .85;
}
`,
		script: `var banner = document.getElementById('banner');
var title = document.getElementById('title');
var sub = document.getElementById('sub');
var timer = null;
function show(titleText, subText) {
  title.textContent = titleText;
  sub.textContent = subText || '';
  banner.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(function () { banner.classList.remove('show'); }, 5000);
}
function onTwitchSub(data) {
  if (data.kind === 'gift' || data.kind === 'gift-bomb') {
    show('GIFT', (data.gifter || '') + ' ×' + (data.giftCount || 1) + (data.recipient ? ' → ' + data.recipient : ''));
  } else {
    show('SUB', (data.username || '') + ' · ' + (data.months || 1) + ' мес.');
  }
}
function onTwitchRaid(data) {
  show('RAID', (data.username || '') + ' · ' + (data.viewers || 0) + ' зрителей');
}
function onTwitchBits(data) {
  show('BITS', (data.username || '') + ' · ' + (data.amount || 0));
}
function onLiveVariableUpdate(name, value) {
  if (name === 'color') {
    banner.style.color = value;
    banner.style.borderColor = value;
  }
}
`,
		variables: [
			{ name: 'color', type: 'color', value: '#a78bfa', live: true },
		],
		integrations: { twitchSubs: true, twitchRaids: true, twitchBits: true },
	},
	{
		id: 'tpl-alert',
		name: 'Алерт',		description: 'Баннер, который появляется по кнопке и прячется сам.',
		width: 520,
		height: 110,
		header: '',
		body: '<div id="banner">{text}</div>',
		style: `${baseStyle}
#banner {
  transform: translateY(140%);
  opacity: 0;
  max-width: 94%;
  padding: 14px 22px;
  border-radius: 14px;
  background: rgba(15, 18, 28, .92);
  border: 2px solid {color};
  color: {color};
  font-size: 24px;
  font-weight: 700;
  text-align: center;
  box-shadow: 0 8px 30px rgba(0,0,0,.45);
  transition: transform .25s ease, opacity .25s ease;
  overflow: hidden;
}
#banner.show { transform: translateY(0); opacity: 1; }
`,
		script: `var banner = document.getElementById('banner');
var timer = null;
function onLiveVariableUpdate(name, value) {
  if (name === 'text') banner.textContent = value;
  if (name === 'color') {
    banner.style.borderColor = value;
    banner.style.color = value;
  }
  if (name === 'show') {
    banner.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(function () { banner.classList.remove('show'); }, 3000);
  }
}
`,
		variables: [
			{ name: 'text', type: 'string', value: 'Новый донат!', live: true },
			{ name: 'color', type: 'color', value: '#f472b6', live: true },
			{
				name: 'show',
				type: 'button',
				value: 'show',
			},
		],
	},
]
