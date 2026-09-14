import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { validateAttachment, type UploadedFileLike } from '../src/attachments/attachments.service';

function fileFor(name: string, mimetype: string, buffer: Buffer): UploadedFileLike {
  return { originalname: name, mimetype, size: buffer.length, buffer };
}

const ZIP_LOCAL_HEADER_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Builds a minimal ZIP container: the 4-byte local-file-header signature every reader checks for
 * "is this a zip at all", followed by the central directory entries `validateZipEntries` actually
 * reads (declared sizes only -- no real compressed payload is needed since that function never
 * inflates anything), followed by the end-of-central-directory record pointing back at them.
 */
function buildZip(
  entries: readonly { compressedSize: number; uncompressedSize: number }[],
  options: { declaredEntryCount?: number } = {},
): Buffer {
  const centralDirStart = ZIP_LOCAL_HEADER_SIGNATURE.length;
  const centralDir = Buffer.concat(
    entries.map((entry) => {
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0);
      record.writeUInt32LE(entry.compressedSize, 20);
      record.writeUInt32LE(entry.uncompressedSize, 24);
      return record;
    }),
  );
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.declaredEntryCount ?? entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  return Buffer.concat([ZIP_LOCAL_HEADER_SIGNATURE, centralDir, eocd]);
}

describe('validateAttachment', () => {
  it('accepts a well-formed PDF', () => {
    const buffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('unencrypted content')]);
    expect(() => validateAttachment(fileFor('r.pdf', 'application/pdf', buffer))).not.toThrow();
  });

  it('accepts a well-formed PNG and JPEG', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('rest')]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('rest')]);
    expect(() => validateAttachment(fileFor('r.png', 'image/png', png))).not.toThrow();
    expect(() => validateAttachment(fileFor('r.jpg', 'image/jpeg', jpeg))).not.toThrow();
  });

  it('accepts plain-text CSV and TXT content', () => {
    const buffer = Buffer.from('date,amount\n2024-01-01,10.00\n');
    expect(() => validateAttachment(fileFor('r.csv', 'text/csv', buffer))).not.toThrow();
    expect(() => validateAttachment(fileFor('r.txt', 'text/plain', buffer))).not.toThrow();
  });

  it('rejects an unsupported extension before looking at content at all', () => {
    expect(() =>
      validateAttachment(fileFor('r.exe', 'application/octet-stream', Buffer.from('MZ'))),
    ).toThrow(/Only PDF, image, CSV, XLSX, DOCX/);
  });

  it('rejects content whose bytes do not match the declared extension (type spoofing)', () => {
    const notActuallyAPdf = Buffer.from('this is plainly not a PDF file');
    expect(() => validateAttachment(fileFor('r.pdf', 'application/pdf', notActuallyAPdf))).toThrow(
      /do not match its declared type/,
    );
  });

  it('rejects binary content declared as text', () => {
    const withNullByte = Buffer.from([0x41, 0x42, 0x00, 0x43]);
    expect(() => validateAttachment(fileFor('r.txt', 'text/plain', withNullByte))).toThrow(
      /do not match its declared type/,
    );
  });

  it('rejects an encrypted PDF even though its signature is valid', () => {
    const encrypted = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.from('1 0 obj << /Encrypt 2 0 R >>'),
    ]);
    expect(() => validateAttachment(fileFor('r.pdf', 'application/pdf', encrypted))).toThrow(
      /Encrypted PDFs are not supported/,
    );
  });

  it('accepts a well-formed, modestly-sized XLSX zip container', () => {
    const zip = buildZip([{ compressedSize: 500, uncompressedSize: 1000 }]);
    expect(() =>
      validateAttachment(
        fileFor('r.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip),
      ),
    ).not.toThrow();
  });

  it('rejects a zip with a corrupt or missing end-of-central-directory record', () => {
    const corrupt = Buffer.concat([ZIP_LOCAL_HEADER_SIGNATURE, Buffer.from('not a real zip tail')]);
    expect(() =>
      validateAttachment(
        fileFor(
          'r.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          corrupt,
        ),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a zip declaring more entries than the safety cap allows', () => {
    const zip = buildZip([{ compressedSize: 10, uncompressedSize: 10 }], {
      declaredEntryCount: 5_000,
    });
    expect(() =>
      validateAttachment(
        fileFor('r.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip),
      ),
    ).toThrow(/too many entries/);
  });

  it('rejects a decompression bomb: one entry expanding past the total-uncompressed-bytes cap', () => {
    const zip = buildZip([{ compressedSize: 1_000, uncompressedSize: 300 * 1024 * 1024 }]);
    expect(() =>
      validateAttachment(
        fileFor('r.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip),
      ),
    ).toThrow(/expands to more data/);
  });

  it('rejects a single entry with a suspiciously high compression ratio', () => {
    const zip = buildZip([{ compressedSize: 100, uncompressedSize: 2_000_000 }]);
    expect(() =>
      validateAttachment(
        fileFor('r.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip),
      ),
    ).toThrow(/suspiciously compressed/);
  });

  it('does not flag a large entry whose compression ratio is unremarkable', () => {
    // 2MB uncompressed from 1.5MB compressed -- large, but nowhere near the 200x ratio cap, and
    // under the 200MB total-uncompressed cap.
    const zip = buildZip([{ compressedSize: 1_500_000, uncompressedSize: 2_000_000 }]);
    expect(() =>
      validateAttachment(
        fileFor('r.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip),
      ),
    ).not.toThrow();
  });
});
