// Document workflow: presign upload -> (SPA uploads photo) -> Claude parse into
// a draft -> human reviews -> confirm attaches the document to an order.
// Nothing is ever auto-saved from a parse; the draft lives on the document row
// until a human confirms it.
import type { DocumentsRepo, DocumentRow } from '../data/documents.repo';
import { DomainError, Tx } from '../types';
import type { BillParser, ParseKind } from './ai/parser';
import { newStorageKey, ObjectStore } from './objectstore';

export interface StartUploadResult {
  documentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

export interface DocumentsService {
  startUpload(kind: ParseKind, contentType: string, uploadedBy: string | null): Promise<StartUploadResult>;
  parseDocument(id: string): Promise<unknown>;
  viewUrl(id: string): Promise<string>;
  /** Marks documents 'confirmed' and links them to the order (offline-order confirm). */
  attachToOrder(documentIds: string[], orderId: string, tx?: Tx): Promise<void>;
  listByOrder(orderId: string): Promise<DocumentRow[]>;
}

export function createDocumentsService(deps: {
  documents: DocumentsRepo;
  store: ObjectStore;
  /** Null when no Anthropic API key is configured — uploads still work, parsing 503s. */
  parser: BillParser | null;
}): DocumentsService {
  return {
    async startUpload(kind, contentType, uploadedBy) {
      const storageKey = newStorageKey(kind);
      const doc = await deps.documents.create({ storageKey, kind, contentType, uploadedBy });
      const { url, headers } = await deps.store.presignPut(storageKey, contentType);
      return { documentId: doc.id, uploadUrl: url, headers };
    },

    async parseDocument(id) {
      const doc = await deps.documents.getById(id);
      if (!doc) throw new DomainError('NOT_FOUND', 'Document not found');
      if (!deps.parser) {
        throw new DomainError('NOT_CONFIGURED', 'Document parsing is not configured (missing Anthropic API key)');
      }
      const { bytes, contentType } = await deps.store.getObject(doc.storageKey);
      const draft = await deps.parser.parse(doc.kind, { bytes, mediaType: contentType });
      await deps.documents.setParse(id, draft, 'parsed');
      return draft;
    },

    async viewUrl(id) {
      const doc = await deps.documents.getById(id);
      if (!doc) throw new DomainError('NOT_FOUND', 'Document not found');
      return deps.store.presignGet(doc.storageKey);
    },

    async attachToOrder(documentIds, orderId, tx) {
      if (documentIds.length === 0) return;
      await deps.documents.setStatusAndOrder(documentIds, 'confirmed', orderId, tx);
    },

    listByOrder(orderId) {
      return deps.documents.listByOrder(orderId);
    },
  };
}
