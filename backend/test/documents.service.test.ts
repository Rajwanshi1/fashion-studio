import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ParserUnavailableError, type ParseKind } from '../src/services/ai/parser';
import { createDocumentsService, DocumentsService } from '../src/services/documents.service';
import { LocalObjectStore } from '../src/services/objectstore';
import { DomainError } from '../src/types';
import { FakeBillParser, FakeDocumentsRepo } from './fakes';

describe('DocumentsService', () => {
  let dir: string;
  let repo: FakeDocumentsRepo;
  let store: LocalObjectStore;
  let parser: FakeBillParser;
  let service: DocumentsService;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'documents-service-test-'));
    repo = new FakeDocumentsRepo();
    store = new LocalObjectStore(dir, 'http://localhost:4000');
    parser = new FakeBillParser();
    service = createDocumentsService({ documents: repo, store, parser });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('startUpload', () => {
    it('creates an uploaded row with a generated storage key and returns the presigned URL + headers', async () => {
      const result = await service.startUpload('bill', 'image/jpeg', 'admin-1');

      expect(repo.docs).toHaveLength(1);
      const doc = repo.docs[0];
      expect(doc.id).toBe(result.documentId);
      expect(doc.status).toBe('uploaded');
      expect(doc.kind).toBe('bill');
      expect(doc.contentType).toBe('image/jpeg');
      expect(doc.uploadedBy).toBe('admin-1');
      expect(doc.storageKey).toMatch(/^bill\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);

      expect(result.uploadUrl).toBe(
        `http://localhost:4000/api/uploads/local/${encodeURIComponent(doc.storageKey)}`,
      );
      expect(result.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    });
  });

  describe('parseDocument', () => {
    async function uploadedDoc(kind: ParseKind = 'bill') {
      const { documentId } = await service.startUpload(kind, 'image/png', 'admin-1');
      await store.put(repo.docs[0].storageKey, new Uint8Array([5, 6, 7]), 'image/png');
      return documentId;
    }

    it('reads the stored object, parses it, saves the draft + status parsed, and returns the draft', async () => {
      const id = await uploadedDoc('measurement');
      parser.draft = { person_name: 'Asha', measurements: [{ name: 'SH', value: '15 in' }] };

      const draft = await service.parseDocument(id);

      expect(draft).toEqual(parser.draft);
      expect(parser.calls).toEqual([{ kind: 'measurement', mediaType: 'image/png', byteLength: 3 }]);
      expect(repo.docs[0].parse).toEqual(parser.draft);
      expect(repo.docs[0].status).toBe('parsed');
    });

    it('throws NOT_FOUND for a missing document', async () => {
      await expect(service.parseDocument('00000000-0000-4000-8000-999999999999')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(service.parseDocument('nope')).rejects.toBeInstanceOf(DomainError);
    });

    it('throws NOT_CONFIGURED when the parser is null (and leaves the row untouched)', async () => {
      const id = await uploadedDoc();
      const noParser = createDocumentsService({ documents: repo, store, parser: null });
      await expect(noParser.parseDocument(id)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
      expect(repo.docs[0].status).toBe('uploaded');
      expect(repo.docs[0].parse).toBeNull();
    });

    it('does not save a parse when the parser throws', async () => {
      const id = await uploadedDoc();
      parser.failWith = new Error('Claude returned malformed JSON');
      await expect(service.parseDocument(id)).rejects.toThrow(/malformed JSON/);
      expect(repo.docs[0].status).toBe('uploaded');
      expect(repo.docs[0].parse).toBeNull();
    });

    it('maps an unavailable parser to NOT_CONFIGURED so the wizard falls back to manual entry', async () => {
      const id = await uploadedDoc();
      parser.failWith = new ParserUnavailableError('model access not granted in the Bedrock console');
      await expect(service.parseDocument(id)).rejects.toMatchObject({
        code: 'NOT_CONFIGURED',
        message: /model access not granted/,
      });
      expect(repo.docs[0].status).toBe('uploaded');
      expect(repo.docs[0].parse).toBeNull();
    });
  });

  describe('viewUrl', () => {
    it('presigns a GET for the document storage key', async () => {
      const { documentId } = await service.startUpload('shipping_receipt', 'image/jpeg', null);
      const url = await service.viewUrl(documentId);
      expect(url).toBe(`http://localhost:4000/api/uploads/local/${encodeURIComponent(repo.docs[0].storageKey)}`);
    });

    it('throws NOT_FOUND for a missing document', async () => {
      await expect(service.viewUrl('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('attachToOrder', () => {
    it('marks the given documents confirmed and links them to the order', async () => {
      const a = await service.startUpload('bill', 'image/jpeg', 'admin-1');
      const b = await service.startUpload('measurement', 'image/jpeg', 'admin-1');
      const untouched = await service.startUpload('bill', 'image/jpeg', 'admin-1');

      await service.attachToOrder([a.documentId, b.documentId], 'order-42');

      expect(repo.docs.find((d) => d.id === a.documentId)).toMatchObject({ status: 'confirmed', orderId: 'order-42' });
      expect(repo.docs.find((d) => d.id === b.documentId)).toMatchObject({ status: 'confirmed', orderId: 'order-42' });
      expect(repo.docs.find((d) => d.id === untouched.documentId)).toMatchObject({ status: 'uploaded', orderId: null });

      const listed = await service.listByOrder('order-42');
      expect(listed.map((d) => d.id).sort()).toEqual([a.documentId, b.documentId].sort());
    });

    it('is a no-op for an empty id list', async () => {
      await expect(service.attachToOrder([], 'order-42')).resolves.toBeUndefined();
    });
  });
});
