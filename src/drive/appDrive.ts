/** The app's Drive client, signed in with the browser sign-in (`auth/google.ts`). */
import { auth } from '../auth/google';
import { createDriveClient } from './client';

export const drive = createDriveClient(auth);
