import { describe, expect, test } from 'vitest'
import { StructError, struct } from './index'
import { parseStructTuple as parse } from './introspection'

describe('constructors.ts browser primitives', () => {
  test('blob / file / arrayBuffer validate native Web API instances', () => {
    const blob = new Blob(['hello'], { type: 'text/plain' })
    const file = new File(['data'], 'doc.txt', { type: 'text/plain' })
    const buffer = new ArrayBuffer(8)

    const [be, bv] = parse(struct.blob(), blob)
    if (be) {
      throw be
    }
    expect(bv).toBe(blob)

    const [fe, fv] = parse(struct.file(), file)
    if (fe) {
      throw fe
    }
    expect(fv).toBe(file)

    const [ae, av] = parse(struct.arrayBuffer(), buffer)
    if (ae) {
      throw ae
    }
    expect(av).toBe(buffer)

    const [badBlob] = parse(struct.blob(), 'not a blob')
    expect(badBlob).toBeInstanceOf(StructError)

    const [badFile] = parse(struct.file(), blob)
    expect(badFile).toBeInstanceOf(StructError)

    const [badAb] = parse(struct.arrayBuffer(), file)
    expect(badAb).toBeInstanceOf(StructError)
  })

  test('blob, file, and arrayBuffer require explicit values', () => {
    const [blobErr, blob] = parse(struct.blob(), undefined)
    const [fileErr, file] = parse(struct.file(), undefined)
    const [bufferErr, buffer] = parse(struct.arrayBuffer(), undefined)

    expect(blobErr).toBeInstanceOf(StructError)
    expect(fileErr).toBeInstanceOf(StructError)
    expect(bufferErr).toBeInstanceOf(StructError)
    expect(blob).toBeUndefined()
    expect(file).toBeUndefined()
    expect(buffer).toBeUndefined()
  })

  test('upload object struct integrates web types end-to-end', async () => {
    const uploadStruct = struct.object({
      attachment: struct.file(),
      cover: struct.blob(),
      bytes: struct.arrayBuffer(),
      caption: struct.string(),
    })

    const payload = {
      attachment: new File(['image'], 'avatar.png', { type: 'image/png' }),
      cover: new Blob(['cover'], { type: 'image/jpeg' }),
      bytes: new ArrayBuffer(16),
      caption: 'hello',
    }

    const [err, parsed] = parse(uploadStruct, payload)
    if (err) {
      throw err
    }
    expect(parsed.attachment.name).toBe('avatar.png')
    expect(parsed.cover.type).toBe('image/jpeg')
    expect(parsed.bytes.byteLength).toBe(16)

    const [tupleErr, tupleVal] = parse(uploadStruct, payload)
    if (tupleErr) {
      throw tupleErr
    }
    expect(tupleVal).toMatchObject({ caption: 'hello' })
  })

  test('date and bigint work in browser runtime', () => {
    const d = new Date('2026-05-12T08:00:00Z')
    const [de, dv] = parse(struct.date(), d)
    if (de) {
      throw de
    }
    expect(dv).toBe(d)

    const [be, bv] = parse(struct.bigint(), 2026n)
    if (be) {
      throw be
    }
    expect(bv).toBe(2026n)
  })

  test('object struct accepts payloads with Web API instances', () => {
    const userStruct = struct.object({
      avatar: struct.file(),
      name: struct.string(),
    })

    const [error, value] = parse(userStruct, {
      avatar: new File([''], 'cover.png'),
      name: 'x',
    })
    if (error) {
      throw error
    }
    expect(value.name).toBe('x')
  })
})
