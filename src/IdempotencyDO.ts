export class IdempotencyDO implements DurableObject {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.replace('/', '');
    const { key, receipt } = (await request.json()) as { key: string; receipt?: unknown };

    if (action === 'reserve') {
      const existing = await this.state.storage.get(key);
      if (existing) {
        return new Response(JSON.stringify({ status: 'LOCKED', existing }), { status: 409 });
      }
      await this.state.storage.put(key, { status: 'PENDING', reservedAt: Date.now() });
      await this.state.storage.setAlarm(Date.now() + 60_000);
      return new Response(JSON.stringify({ status: 'RESERVED' }), { status: 200 });
    }

    if (action === 'finalize') {
      await this.state.storage.put(key, { status: 'COMPLETED', receipt });
      await this.state.storage.setAlarm(Date.now() + 86400_000);
      return new Response(JSON.stringify({ status: 'SUCCESS' }), { status: 200 });
    }

    if (action === 'release') {
      await this.state.storage.delete(key);
      return new Response(JSON.stringify({ status: 'RELEASED' }), { status: 200 });
    }

    return new Response('Invalid action', { status: 400 });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}
