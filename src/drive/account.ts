import type { DriveClient } from './client';

export interface Account {
  displayName: string;
  emailAddress: string;
}

/** The signed-in user, from Drive's `about` endpoint (works with `drive.file`). */
export async function getAccount(drive: DriveClient): Promise<Account> {
  const about = await drive.json<{ user: Account }>(
    '/drive/v3/about?fields=user(displayName,emailAddress)',
  );
  return about.user;
}
