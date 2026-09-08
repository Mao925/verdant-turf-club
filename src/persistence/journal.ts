import type { Envelope, Patch, World } from "../domain/world";
export type Pending = {
  id: string;
  expectedRevision: number;
  state: World;
  patch: Patch;
};
export type LocalRecord = {
  accountId: string;
  confirmed: Envelope | null;
  pending: Pending | null;
};
export interface Journal {
  read(accountId: string): Promise<LocalRecord>;
  prepare(accountId: string, pending: Pending): Promise<void>;
  confirm(
    accountId: string,
    envelope: Envelope,
    commandId?: string,
  ): Promise<void>;
  discard(accountId: string, commandId: string): Promise<void>;
}
export class BrowserJournal implements Journal {
  private db: Promise<IDBDatabase>;
  constructor() {
    this.db = new Promise((resolve, reject) => {
      const r = indexedDB.open("verdant-owner-v1", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("accounts", { keyPath: "accountId" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error("端末の保存領域を開けませんでした。"));
      r.onblocked = () =>
        reject(new Error("別タブを閉じて再読み込みしてください。"));
    });
  }
  private async change(
    accountId: string,
    fn?: (r: LocalRecord) => LocalRecord,
  ): Promise<LocalRecord> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("accounts", fn ? "readwrite" : "readonly"),
        store = tx.objectStore("accounts");
      const get = store.get(accountId);
      let out: LocalRecord;
      let error: unknown;
      get.onsuccess = () => {
        try {
          out = get.result ?? { accountId, confirmed: null, pending: null };
          if (fn) {
            out = fn(out);
            store.put(out);
          }
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(out);
      tx.onabort = tx.onerror = () =>
        reject(
          error ??
            new Error(
              "端末への保存に失敗しました。空き容量を確認してください。",
            ),
        );
    });
  }
  read(accountId: string) {
    return this.change(accountId);
  }
  async prepare(accountId: string, pending: Pending) {
    await this.change(accountId, (r) => {
      if (r.pending && r.pending.id !== pending.id)
        throw new Error(
          "別タブの未送信処理があります。最新状態を読み直してください。",
        );
      return { ...r, pending };
    });
  }
  async confirm(accountId: string, envelope: Envelope, commandId?: string) {
    await this.change(accountId, (r) => ({
      ...r,
      confirmed:
        !r.confirmed || envelope.revision >= r.confirmed.revision
          ? envelope
          : r.confirmed,
      pending: r.pending?.id === commandId ? null : r.pending,
    }));
  }
  async discard(accountId: string, commandId: string) {
    await this.change(accountId, (r) => ({
      ...r,
      pending: r.pending?.id === commandId ? null : r.pending,
    }));
  }
}
