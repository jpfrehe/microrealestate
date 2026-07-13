import getApiFetcher from '@/utils/fetch/server';
import getServerEnv from '@/utils/env/server';
import mockedSession from '@/mocks/session';
import type { Session } from '@/types';

export default async function getServerSession(): Promise<Session | null> {
  let session = null;
  if (getServerEnv('DEMO_MODE') === 'true') {
    session = mockedSession;
  } else {
    try {
      const apiFetcher = await getApiFetcher();
      const response = await apiFetcher.get(
        '/api/v2/authenticator/tenant/session'
      );
      session = response.data;
    } catch (e) {
      console.error(e);
    }
  }
  return session;
}
