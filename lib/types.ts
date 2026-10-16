export type ElementType = 'image' | 'gif' | 'video' | 'iframe' | 'text' | 'timer';

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
  // громкость 0..1 и длительность проигрывания в секундах (не больше 10)
  soundSrc?: string;
  soundVolume?: number;
  soundDuration?: number;
  visible: boolean;
  alwaysLoaded?: boolean;
  locked?: boolean;
  autoplay?: boolean;
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
}

// Кто сейчас на странице комнаты (для списка участников в шапке панели):
// streamer — автор панели, moderator — приглашённый модератор, guest — оверлей в OBS
export type RoomUser = {
  login: string;
  role: 'streamer' | 'moderator' | 'guest';
  connections: number;
};
