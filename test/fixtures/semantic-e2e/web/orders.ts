export async function submit(id: string): Promise<Response> {
  if (!id) throw new Error('id required');
  return fetch('https://orders.dev/orders', { method: 'POST', body: id });
}
