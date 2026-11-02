import type { WidgetTemplate } from './widgetTemplates'

// Красивый оверлей-чат Twitch. Данные сообщения — то, что сервер присылает
// в onTwitchMessage (см. parseTwitchMessage в server.js): username, color,
// badges, bits, isAction, isBroadcaster/isMod/isVip/isSubscriber и raw.tags
// (там лежит emotes — позиции смайлов в исходном тексте).
export const CHAT_WIDGET_TEMPLATE: WidgetTemplate = {
	id: 'tpl-chat',
	name: 'Чат Twitch',
	description:
		'Красивый оверлей-чат: стеклянная подложка, бейджи, цветные ники, смайлы Twitch и анимация появления.',
	width: 400,
	height: 420,
	header: '',
	body: '<div id="wrap"><div id="title"><span class="dot"></span><span id="title-text">{title}</span></div><div id="list"></div></div>',
	style: `body {
  display: block;
  box-sizing: border-box;
  padding: 12px 14px;
  color: #fff;
  background: rgba(12, 15, 24, calc(var(--a, 75) / 100));
  border: 1px solid rgba(255, 255, 255, .09);
  border-radius: 16px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, .35), inset 0 1px 0 rgba(255,255,255,.05);
  --accent: {accent};
  --fs: {size}px;
  --a: {alpha};
}
#wrap { display: flex; flex-direction: column; width: 100%; height: 100%; }
#title {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, .55);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
}
#list {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 3px;
  font-size: var(--fs, 16px);
  line-height: 1.35;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 16px);
  mask-image: linear-gradient(to bottom, transparent 0, #000 16px);
}
.row {
  display: block;
  padding: 4px 9px;
  border-radius: 10px;
  background: rgba(255, 255, 255, .04);
  animation: pop .22s cubic-bezier(.2, .8, .3, 1) both;
}
@keyframes pop {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
.badge {
  display: inline-block;
  width: 1.05em;
  height: 1.05em;
  margin-right: 4px;
  vertical-align: -0.14em;
}
.badge svg { width: 100%; height: 100%; display: block; filter: drop-shadow(0 1px 1px rgba(0,0,0,.6)); }
.badge.b-broadcaster { color: #e91916; }
.badge.b-mod { color: #00ad03; }
.badge.b-vip { color: #e005b9; }
.badge.b-sub { color: #9147ff; }
#wrap.no-badges .badge { display: none; }
.name { font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,.8); }
.text {
  color: rgba(255, 255, 255, .96);
  text-shadow: 0 1px 2px rgba(0,0,0,.8);
  overflow-wrap: anywhere;
}
.text .emote {
  height: 1.4em;
  vertical-align: -0.35em;
  border-radius: 3px;
}
.bits {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--accent);
  color: #0b0e13;
  font-size: .72em;
  font-weight: 700;
  vertical-align: .12em;
}
`,
	script: `var wrap = document.getElementById('wrap');
var list = document.getElementById('list');
var titleText = document.getElementById('title-text');
var limit = parseInt('{maxMsg}', 10) || 10;

// Twitch-палитра «случайного» цвета ника, если чат не задал свой
var PALETTE = ['#ff0000','#0000ff','#00ff00','#b22222','#ff7f50','#9acd32','#ff4500','#2e8b57','#daa520','#d2691e','#5f9ea0','#1e90ff','#ff69b4','#8a2be2','#00ff7f'];
function nameColor(data) {
  if (data.color) return data.color;
  var hash = 0;
  var s = data.login || data.username || '';
  for (var i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

var BADGES = {
  broadcaster: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 12.5L1 5.5l3.7 2.2L8 3l3.3 4.7L15 5.5l-1 7z"/></svg>',
  mod: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 14l6.5-6.5-2-2L0.5 12 2 14zM10 3.5L12.5 1l2.5 2.5L12.5 6z"/></svg>',
  vip: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5L14 6l-6 8.5L2 6z"/></svg>',
  sub: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4 4.2 13.4l.7-4.3-3.1-3 4.3-.6z"/></svg>'
};
function addBadge(row, kind, title) {
  var b = document.createElement('span');
  b.className = 'badge b-' + kind;
  b.title = title;
  b.innerHTML = BADGES[kind];
  row.appendChild(b);
}
function addBadges(row, data) {
  if (data.isBroadcaster) addBadge(row, 'broadcaster', 'Стример');
  if (data.isVip) addBadge(row, 'vip', 'VIP');
  if (data.isMod) addBadge(row, 'mod', 'Модератор');
  if (data.isSubscriber) addBadge(row, 'sub', 'Сабскрайбер');
}

// Смайлы: raw.tags.emotes = "id:от-до,id-код/...". Позиции считаются по
// исходному сообщению; для /me (ACTION) видимый текст обрезан на 8 символов.
function addText(row, data) {
  var msg = data.message || '';
  // страховка: сервер обычно уже срезает обёртку /me, но если пришла — уберём
  if (msg.charCodeAt(0) === 1) {
    msg = msg.slice(8);
    if (msg.charCodeAt(msg.length - 1) === 1) msg = msg.slice(0, -1);
  }
  var text = document.createElement('span');
  text.className = 'text';
  var ranges = [];
  var tags = data.raw && data.raw.tags;
  if (tags && tags.emotes) {
    var offset = data.isAction ? 8 : 0;
    var groups = tags.emotes.split('/');
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i].split(':');
      if (g.length < 2) continue;
      var rr = g[1].split(',');
      for (var j = 0; j < rr.length; j++) {
        var ab = rr[j].split('-');
        var s = parseInt(ab[0], 10) - offset;
        var e = parseInt(ab[1], 10) - offset;
        if (isNaN(s) || isNaN(e) || s < 0 || e >= msg.length) continue;
        ranges.push({ id: g[0], s: s, e: e });
      }
    }
    ranges.sort(function (a, b) { return a.s - b.s; });
  }
  var pos = 0;
  for (var k = 0; k < ranges.length; k++) {
    var r = ranges[k];
    if (r.s > pos) text.appendChild(document.createTextNode(msg.slice(pos, r.s)));
    var img = document.createElement('img');
    img.className = 'emote';
    var code = msg.slice(r.s, r.e + 1);
    img.src = 'https://static-cdn.jtvnw.net/emoticons/v2/' + r.id + '/default/dark/2.0';
    img.alt = code;
    img.addEventListener('error', function () {
      var t = document.createTextNode(this.alt);
      this.parentNode.replaceChild(t, this);
    });
    text.appendChild(img);
    pos = r.e + 1;
  }
  if (pos < msg.length) text.appendChild(document.createTextNode(msg.slice(pos)));
  if (data.isAction) text.style.cssText = 'font-style: italic;';
  row.appendChild(text);
  if (data.bits > 0) {
    var chip = document.createElement('span');
    chip.className = 'bits';
    chip.textContent = '+' + data.bits + ' bits';
    row.appendChild(chip);
  }
}

function onTwitchMessage(data) {
  var row = document.createElement('div');
  row.className = 'row';
  addBadges(row, data);
  var name = document.createElement('span');
  name.className = 'name';
  name.textContent = data.username + ':';
  name.style.color = nameColor(data);
  row.appendChild(name);
  row.appendChild(document.createTextNode(' '));
  addText(row, data);
  list.appendChild(row);
  while (list.children.length > limit) list.removeChild(list.firstChild);
}

function onLiveVariableUpdate(name, value) {
  if (name === 'title') titleText.textContent = value;
  if (name === 'accent') wrap.style.setProperty('--accent', value);
  if (name === 'size') wrap.style.setProperty('--fs', value + 'px');
  if (name === 'alpha') wrap.style.setProperty('--a', value);
  if (name === 'badges') wrap.classList.toggle('no-badges', value !== 'true');
  if (name === 'maxMsg') {
    limit = parseInt(value, 10) || 10;
    while (list.children.length > limit) list.removeChild(list.firstChild);
  }
}
`,
	variables: [
		{ name: 'title', type: 'string', value: 'Чат', live: true },
		{ name: 'accent', type: 'color', value: '#a78bfa', live: true },
		{
			name: 'size',
			type: 'slider',
			value: '16',
			live: true,
			min: 12,
			max: 32,
			step: 1,
		},
		{
			name: 'alpha',
			type: 'slider',
			value: '75',
			live: true,
			min: 0,
			max: 100,
			step: 5,
		},
		{
			name: 'maxMsg',
			type: 'slider',
			value: '10',
			live: true,
			min: 3,
			max: 25,
			step: 1,
		},
		{ name: 'badges', type: 'boolean', value: 'true', live: true },
	],
	integrations: { twitchChat: true },
}
