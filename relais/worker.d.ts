export interface RelayEnv {
  RIOT_API_KEY: string;
  BUILD_CODE?: string;
  BUILDS?: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
}
declare const worker: {
  fetch(request: Request, env: RelayEnv, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response>;
};
export default worker;
export function cleanBuild(b: unknown): string | { items: number[]; keystone?: number; skills?: string; note?: string };
