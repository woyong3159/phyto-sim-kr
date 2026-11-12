// 단일 파일 빌드용: 서비스 워커가 없으므로 아무 일도 하지 않는다.
export function registerSW(_options?: unknown): (reload?: boolean) => Promise<void> {
  return async () => {};
}
