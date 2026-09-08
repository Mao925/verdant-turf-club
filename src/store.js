import { makeCard } from './simulation.js';

export const STORAGE_KEY = 'verdant-turf-v1';
export function newSeed() { return Math.floor(Math.random() * 0xffffffff); }
export function initialState(seed = newSeed()) {
  return { version: 1, balance: 10000, round: 1, card: makeCard(seed), pending: null, history: [], quality: 'high' };
}
export function validateBet(state, horseId, amount) {
  if (state.pending) return 'このレースの購入は確定しています。';
  if (!state.card.horses.some(h => h.id === horseId)) return '出走表から応援する馬を選んでください。';
  if (!Number.isSafeInteger(amount) || amount < 100 || amount % 100 !== 0) return '購入額は100コイン単位で入力してください。';
  if (amount > state.balance) return 'コインが不足しています。購入額を下げてください。';
  return '';
}
export function placeBet(state, horseId, amount, seed, now) {
  const error = validateBet(state, horseId, amount);
  if (error) throw new Error(error);
  const horse = state.card.horses.find(h => h.id === horseId);
  return { ...state, balance: state.balance - amount, pending: {
    id: `${state.round}-${seed}-${now}`, horseId, amount, odds: horse.odds, seed, startedAt: now,
  } };
}
export function settleBet(state, ticketId, results, now) {
  if (!state.pending || state.pending.id !== ticketId || state.history.some(h => h.id === ticketId)) return state;
  const ticket = state.pending;
  const payout = results[0].id === ticket.horseId ? Math.floor(ticket.amount * ticket.odds) : 0;
  const entry = { ...ticket, payout, results, card: state.card, settledAt: now };
  return { ...state, balance: state.balance + payout, pending: null, history: [entry, ...state.history].slice(0, 10) };
}
export function nextRace(state, seed) {
  if (state.pending) throw new Error('レースの終了をお待ちください。');
  return { ...state, round: state.round + 1, card: makeCard(seed, state.round + 1) };
}

function validCard(card, round) {
  return card && Number.isInteger(card.seed) && card.round === round && typeof card.name === 'string' &&
    Array.isArray(card.horses) && card.horses.length === 8 && card.horses.every((h, i) =>
      h.id === i + 1 && typeof h.name === 'string' && Number.isFinite(h.odds) && h.odds >= 1.2 &&
      Number.isFinite(h.speed) && Number.isFinite(h.stamina) && Number.isInteger(h.condition) &&
      ['逃げ', '先行', '差し', '追込'].includes(h.style));
}
export function parseState(raw) {
  if (!raw) return initialState();
  const s = JSON.parse(raw);
  if (s.version !== 1 || !Number.isSafeInteger(s.balance) || s.balance < 0 || !Number.isInteger(s.round) || s.round < 1 ||
    !validCard(s.card, s.round) || !Array.isArray(s.history) || s.history.length > 10 ||
    !s.history.every(h => typeof h.id === 'string' && Number.isFinite(h.payout) && validCard(h.card, h.card?.round) && Array.isArray(h.results) && h.results.length === 8 && h.results.every(r => Number.isFinite(r.time) && r.id >= 1 && r.id <= 8)) ||
    (s.pending && (typeof s.pending.id !== 'string' || !Number.isInteger(s.pending.seed) || !Number.isFinite(s.pending.startedAt) ||
      !Number.isSafeInteger(s.pending.amount) || s.pending.amount < 100 || s.pending.amount % 100 ||
      !s.card.horses.some(h => h.id === s.pending.horseId && h.odds === s.pending.odds)))) {
    throw new Error('保存データを読み込めません。「データをリセット」から初期化できます。');
  }
  return s;
}

export class GameStore {
  constructor(storage) {
    this.storage = storage;
    this.state = this.read();
    if (this.storage.getItem(STORAGE_KEY) === null) this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }
  read() { return parseState(this.storage.getItem(STORAGE_KEY)); }
  async update(transform) {
    const commit = () => {
      const current = this.read();
      const next = transform(current);
      if (next !== current) this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
      this.state = next;
      return next;
    };
    // Web Locks serialize purchases and settlement even when two tabs are open.
    if (globalThis.navigator?.locks) return navigator.locks.request(STORAGE_KEY, commit);
    return commit();
  }
  async reset() {
    const commit = () => {
      const next = initialState();
      this.storage.setItem(STORAGE_KEY, JSON.stringify(next)); this.state = next; return next;
    };
    if (globalThis.navigator?.locks) return navigator.locks.request(STORAGE_KEY, commit);
    return commit();
  }
}
