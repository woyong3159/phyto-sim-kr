import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export interface PwaStatus {
  /** 오프라인 실행 준비 완료(모든 파일이 기기에 저장됨). */
  offlineReady: boolean;
  /** 새 버전이 받아져서 적용을 기다리는 중. */
  needRefresh: boolean;
  applyUpdate: () => void;
}

let update: ((reload?: boolean) => Promise<void>) | null = null;
const state = { offlineReady: false, needRefresh: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function initPwa() {
  if (__SINGLE_FILE__ || !('serviceWorker' in navigator)) return;
  update = registerSW({
    onOfflineReady() {
      state.offlineReady = true;
      emit();
    },
    onNeedRefresh() {
      state.needRefresh = true;
      emit();
    },
  });
  // 이미 설치된 상태로 다시 연 경우
  void navigator.serviceWorker.ready.then(() => {
    state.offlineReady = true;
    emit();
  });
}

export function usePwa(): PwaStatus {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  return { ...state, applyUpdate: () => void update?.(true) };
}
