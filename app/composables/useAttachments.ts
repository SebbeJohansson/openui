import { ref } from 'vue';
import type { Attachment } from '~/types/composer';
import { toErrorMessage } from '~/utils/strings';
import { defineFeature } from './useAppContext';

const ATTACHMENT_MIME_ALLOWLIST = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function generateAttachmentId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `att-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File read failed.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('File read failed.'));
    };
    reader.readAsDataURL(file);
  });
}

/** Composer image attachments. */
export const useAttachments = defineFeature('attachments', ({ sendStatus }) => {
  const attachments = ref<Attachment[]>([]);

  /** Add supported image files; returns true when the list changed. */
  async function addFiles(files: File[]): Promise<boolean> {
    const accepted = files.filter((file) => ATTACHMENT_MIME_ALLOWLIST.has(file.type));
    if (accepted.length === 0) {
      sendStatus.value = 'Unsupported attachment type.';
      return false;
    }
    try {
      const next = await Promise.all(
        accepted.map(async (file) => ({
          id: generateAttachmentId(),
          filename: file.name || 'image',
          mime: file.type || 'application/octet-stream',
          dataUrl: await readFileAsDataUrl(file),
        })),
      );
      attachments.value = [...attachments.value, ...next];
      return true;
    } catch (error) {
      sendStatus.value = `Attachment failed: ${toErrorMessage(error)}`;
      return false;
    }
  }

  function remove(id: string) {
    attachments.value = attachments.value.filter((item) => item.id !== id);
  }

  function clear() {
    attachments.value = [];
  }

  return { attachments, addFiles, remove, clear };
});
