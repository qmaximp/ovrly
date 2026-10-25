export type ElementType = 'image' | 'gif' | 'video' | 'audio' | 'iframe' | 'text' | 'timer' | 'widget';

// --- кастомные виджеты (HTML/CSS/JS в sandboxed iframe) ---
// Набор повторяет типы Pogly: 1 String … 12 Checkboxes (см. TYPE_TO_NUM в lib/widgets.ts)
export type WidgetVariableType =
  | 'string'
  | 'boolean'
  | 'toggle'
  | 'color'
  | 'media'
  | 'button'
  | 'slider'
  | 'dropdown'
  | 'datetime'
  | 'counter'
  | 'list'
  | 'checkboxes';

export type WidgetVariable = {
  name: string;
  type: WidgetVariableType;
  value: string;
  live?: boolean;
  min?: number;
  max?: number;
  step?: number;
  // варианты для dropdown / checkboxes
  options?: string[];
};

export type WidgetDefinition = {
  id: string;
  name: string;
  description?: string;
  width: number;
  height: number;
  header: string;
  body: string;
  style: string;
  script: string;
  variables: WidgetVariable[];
  // Включаемые интеграции. Kick не поддерживаем.
  integrations?: {
    twitchChat?: boolean;
    twitchSubs?: boolean;
    twitchRaids?: boolean;
    twitchBits?: boolean;
  };
};

export interface StreamElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  src?: string;
  text?: string;
  fontSize?: number;
  color?: string;
  fontWeight?: string;
  bgColor?: string;
  // прозрачность именно фона (0..1), не всего элемента
  bgOpacity?: number;
  // --- оформление текста (всё необязательное: без значений — как было раньше) ---
  fontFamily?: string; // готовая CSS-строка стека шрифтов
  italic?: boolean;
  underline?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number; // множитель, по умолчанию 1.2
  letterSpacing?: number; // px, может быть отрицательным
  strokeWidth?: number; // обводка букв (px), 0 = выключена
  strokeColor?: string;
  shadow?: boolean;
  shadowColor?: string;
  padding?: number; // внутренний отступ до фона (px)
  radius?: number; // скругление фона (px)
  opacity?: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  duration?: number;
  timerDirection?: 'up' | 'down';
  startTime?: number | null;
  isRunning?: boolean;
  elapsed?: number;
  timerLabel?: string;
  // свой звук окончания таймера (файл с ПК как data-URL) + его настройки:
  // начало выбранного фрагмента и его длительность в секундах (не больше 10),
  // громкость 0..1
  soundSrc?: string;
  soundStart?: number;
  soundVolume?: number;
  soundDuration?: number;
  visible: boolean;
  locked?: boolean;
  autoplay?: boolean;
  // YouTube-плейлист: очередь id видео и текущая позиция. После окончания
  // ролика панель переключает src на следующий (YouTube-плейлист с готовым
  // list=... хранит только src и переключается силами самого YouTube)
  playlist?: string[];
  playlistIndex?: number;
  playlistLoop?: boolean;
  // звуковой элемент: громкость 0..1 и повтор воспроизведения
  volume?: number;
  loop?: boolean;
  // кастомный виджет: снимок кода + текущие значения переменных
  widget?: WidgetDefinition;
  widgetValues?: Record<string, string>;
  zIndex: number;
}

export interface ObsSceneItem {
  itemId: number;
  sourceName: string;
  sourceType: string;
  sceneName: string;
  visible: boolean;
  isGroup: boolean;
  groupName?: string;
  children?: ObsSceneItem[];
}

export interface ObsScene {
  name: string;
  index: number;
  isCurrent: boolean;
}

export interface SyncState {
  elements: StreamElement[];
  canvasW: number;
  canvasH: number;
  // библиотека виджетов комнаты (создаётся в панели, лежит в состоянии комнаты)
  widgets?: Record<string, WidgetDefinition>;
}

// Кто сейчас на странице комнаты (для списка участников в шапке панели):
// streamer — автор панели, moderator — приглашённый модератор, guest — оверлей в OBS
export type RoomUser = {
  login: string;
  role: 'streamer' | 'moderator' | 'guest';
  connections: number;
};
