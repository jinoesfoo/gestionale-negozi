// Setup del progetto int-worker: il codice del worker con DATABASE_URL = TEST_DATABASE_WORKER_URL (ruolo app_worker).
import { loadTestEnv } from './load-test-env';

loadTestEnv('worker');
