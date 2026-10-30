/** Save text as a file through the browser's download (Files on iPhone). */
export function downloadFile(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Safari starts the download after click() returns, so keep the URL a while.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
