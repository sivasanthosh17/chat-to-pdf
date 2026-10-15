/**
 * Saves a converted PDF through a temporary link to its object URL.
 * The URL stays alive while the result is in the recent-conversions list.
 */
export function downloadResult(result) {
  const anchor = document.createElement('a');
  anchor.href = result.previewUrl;
  anchor.download = result.filename || 'conversation.pdf';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  // Removing the link in the same tick can make the browser lose the
  // `download` file name and fall back to the blob's random id
  setTimeout(() => anchor.remove(), 1000);
}
