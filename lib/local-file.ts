type FileSizeAndBlocks = { size: number; blocks: number };

// Cloud sync providers (iCloud Drive, OneDrive, Dropbox) leave placeholder files
// whose bytes live only on the server. Reading one asks the provider for a
// download that may never finish, and a synchronous read then holds the whole
// server. A placeholder reports a size but no allocated blocks.
export function isStoredLocally(stat: FileSizeAndBlocks): boolean {
  return stat.size === 0 || stat.blocks > 0;
}
