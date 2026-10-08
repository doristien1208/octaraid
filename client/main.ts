import './style.css';
import type { C2S, RoomView, S2C } from '../shared/protocol';
import { Audio } from './audio';
import { clear, h, store, toast } from './dom';
import { GameView } from './game/view';
import { Net, TOKEN_KEY } from './net';
import { startSandbox } from './sandbox';
import { entryScreen, type EntryScreen } from './ui/entry';
import { RoomScreen } from './ui/room';

const app = document.getElementById('app')!;
const net = new Net();
const audio = new Audio();
const status = h('div', { class: 'net-status' });
document.body.append(status);

let meId = '';
/** a create / join typed before the connection was up; sent on welcome */
let pending: Extract<C2S, { t: 'create' | 'join' }> | null = null;
/** a create / join is on its way: the 'entry' the server sends right after hello is not a reason to show the entry screen */
let awaiting = false;
let entry: EntryScreen | null = null;
let room: RoomScreen | null = null;
let roomView: RoomView | null = null;
let game: GameView | null = null;

// Browsers only start audio after a user gesture.
for (const ev of ['pointerdown', 'keydown'] as const) document.addEventListener(ev, () => audio.unlock());

function show(el: HTMLElement): void {
  if (app.firstElementChild === el) return;
  clear(app);
  app.append(el);
}

/** The invite code in the address bar (?room=CODE): an invite link, or the room this tab is in. */
function urlCode(): string | undefined {
  return new URLSearchParams(location.search).get('room') ?? undefined;
}

function setUrlCode(code: string | null): void {
  history.replaceState(null, '', code ? `${location.pathname}?room=${code}` : location.pathname);
}

function endGame(): void {
  game?.destroy();
  game = null;
}

function isHost(view: RoomView | null): boolean {
  return !!view?.members.find((m) => m.id === meId)?.host;
}

function showEntry(): void {
  endGame();
  room = null;
  roomView = null;
  entry = entryScreen({
    audio,
    code: urlCode(),
    onCreate: (name) => act({ t: 'create', name }),
    onJoin: (name, code) => act({ t: 'join', code, name }),
  });
  show(entry.el);
}

function act(msg: Extract<C2S, { t: 'create' | 'join' }>): void {
  awaiting = true;
  entry?.setBusy(true);
  if (net.online) net.send(msg);
  else {
    pending = msg;
    net.connect(msg.name);
  }
}

function leave(): void {
  setUrlCode(null);
  net.send({ t: 'leave' }); // the server answers with 'entry'
}

net.onStatus = (s) => {
  status.textContent = s === 'connecting' ? '連線中…' : s === 'offline' ? '連線中斷，正在重新連線…' : '';
  status.classList.toggle('show', s !== 'online');
};

net.onMessage = (m: S2C) => {
  switch (m.t) {
    case 'welcome':
      meId = m.id;
      if (pending) {
        net.send(pending);
        pending = null;
      }
      break;
    case 'entry':
      if (!awaiting) showEntry();
      break;
    case 'room':
      awaiting = false;
      entry = null;
      roomView = m.room;
      setUrlCode(m.room.code);
      if (!room) room = new RoomScreen(meId, (x) => net.send(x), audio, leave);
      room.update(m.room);
      if (m.room.phase === 'waiting' && game) endGame();
      game?.setHost(isHost(m.room));
      if (!game) show(room.el);
      break;
    case 'chat':
      room?.addChat(m.name, m.text);
      game?.addChat(m.name, m.text);
      break;
    case 'tally':
      room?.showTally(m.result);
      break;
    case 'start':
      endGame();
      game = new GameView(m.game, meId, { send: (x) => net.send(x), leave }, audio);
      game.setHost(isHost(roomView));
      show(game.root);
      break;
    case 'snap':
      game?.onSnap(m.s);
      break;
    case 'pos':
      game?.onCorrection(m.x, m.z);
      break;
    case 'end':
      game?.onEnd(m.result);
      break;
    case 'error':
      if (awaiting) {
        awaiting = false;
        entry?.setBusy(false);
      }
      audio.play('error');
      toast(m.msg, 'error');
      break;
    case 'pong':
      break;
  }
};

// Refreshing the page keeps your seat: this tab still has its session token.
let resumable = false;
try {
  resumable = !!sessionStorage.getItem(TOKEN_KEY);
} catch {
  /* ignore */
}
const savedName = store.get('octaraid.name');
if (new URLSearchParams(location.search).has('sandbox')) startSandbox(app, audio);
else if (resumable && savedName) {
  show(h('div', { class: 'screen center' }, h('p', { class: 'muted light' }, '連線中…')));
  net.connect(savedName);
} else showEntry();
