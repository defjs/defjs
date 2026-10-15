export function createNotesForm(): FormData {
  const form = new FormData()
  form.append('title', 'Ada')
  form.append('file', new File(['hello-file'], 'notes.txt', { type: 'application/pdf' }))
  return form
}

export function notesFormBody(contentType: string): string {
  const boundary = /^multipart\/form-data; boundary=(.+)$/.exec(contentType)?.[1]
  if (boundary === undefined) {
    throw new Error(`expected a multipart boundary in ${contentType}`)
  }
  return [
    `--${boundary}`,
    'Content-Disposition: form-data; name="title"',
    '',
    'Ada',
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="notes.txt"',
    'Content-Type: application/pdf',
    '',
    'hello-file',
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

export function decodeBase64(value: string): string {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
