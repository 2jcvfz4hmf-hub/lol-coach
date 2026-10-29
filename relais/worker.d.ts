declare const worker: {
  fetch(request: Request, env: { RIOT_API_KEY: string }, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response>;
};
export default worker;
