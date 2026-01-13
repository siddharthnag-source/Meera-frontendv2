'use client';

import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { ChatAttachmentInputState } from '@/types/chat';

export interface AttachmentInputAreaRef {
  clear: () => void;
  removeAttachment: (index: number) => void;
  processPastedFiles: (files: File[]) => void;
}

interface Props {
  // IMPORTANT: make this a React state setter so we can do functional updates safely
  onAttachmentsChange: React.Dispatch<React.SetStateAction<ChatAttachmentInputState[]>>;
  existingAttachments: ChatAttachmentInputState[];
  maxAttachments: number;
  messageValue: string;
  resetInputHeightState: () => void;
  children?: React.ReactNode;

  // NEW: upload tracker to disable send/enter while uploading
  onUploadingChange?: (isUploading: boolean) => void;
}

const MAX_FILE_SIZE_MB = 25;

export const AttachmentInputArea = forwardRef<AttachmentInputAreaRef, Props>(
  (props, ref) => {
    const {
      onAttachmentsChange,
      existingAttachments,
      maxAttachments,
      children,
      onUploadingChange,
    } = props;

    const fileInputRef = useRef<HTMLInputElement>(null);

    // Track concurrent uploads
    const uploadingCountRef = useRef(0);
    const setUploading = (delta: number) => {
      uploadingCountRef.current = Math.max(0, uploadingCountRef.current + delta);
      onUploadingChange?.(uploadingCountRef.current > 0);
    };

    const uploadToSupabase = async (file: File) => {
      const ext = file.name.split('.').pop() || 'bin';
      const path = `attachments/${Date.now()}-${Math.random()
        .toString(36)
        .substring(2)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('attachments')
        .upload(path, file, { upsert: false });

      if (uploadError) {
        console.error('Supabase upload error:', uploadError);
        return null;
      }

      const { data } = supabase.storage.from('attachments').getPublicUrl(path);

      return {
        storagePath: path,
        publicUrl: data.publicUrl,
      };
    };

    const processFiles = async (files: FileList | File[]) => {
      const fileArray: File[] = Array.isArray(files) ? files : Array.from(files);

      // Pre-filter based on limits
      const accepted: File[] = [];
      for (const file of fileArray) {
        if (accepted.length + existingAttachments.length >= maxAttachments) continue;

        const sizeMb = file.size / (1024 * 1024);
        if (sizeMb > MAX_FILE_SIZE_MB) continue;

        accepted.push(file);
      }

      if (accepted.length === 0) return;

      // Create placeholders immediately (so user sees chips), but they are not "ready"
      // We store a local marker in storagePath so we can update the right item later.
      const placeholders: ChatAttachmentInputState[] = accepted.map((file) => {
        const isImage = file.type.startsWith('image/');
        const type: 'image' | 'document' = isImage ? 'image' : 'document';
        const localId = `__local__/${Date.now()}-${Math.random().toString(36).slice(2)}`;

        return {
          file,
          previewUrl: URL.createObjectURL(file),
          type,
          storagePath: localId, // temporary marker
          publicUrl: undefined,
        };
      });

      onAttachmentsChange((prev) => [...prev, ...placeholders]);

      // Upload all placeholders, update each one when done
      setUploading(+placeholders.length);

      await Promise.all(
        placeholders.map(async (ph) => {
          try {
            const uploaded = await uploadToSupabase(ph.file as File);
            if (!uploaded) {
              // remove failed placeholder
              onAttachmentsChange((prev) => {
                const next = prev.filter((a) => a.storagePath !== ph.storagePath);
                if (ph.previewUrl) URL.revokeObjectURL(ph.previewUrl);
                return next;
              });
              return;
            }

            onAttachmentsChange((prev) =>
              prev.map((a) => {
                if (a.storagePath !== ph.storagePath) return a;
                return {
                  ...a,
                  storagePath: uploaded.storagePath,
                  publicUrl: uploaded.publicUrl,
                };
              }),
            );
          } finally {
            setUploading(-1);
          }
        }),
      );
    };

    const openFilePicker = () => {
      fileInputRef.current?.click();
    };

    useImperativeHandle(ref, () => ({
      clear: () => {
        onAttachmentsChange((prev) => {
          prev.forEach((att) => att.previewUrl && URL.revokeObjectURL(att.previewUrl));
          return [];
        });
        onUploadingChange?.(false);
        uploadingCountRef.current = 0;
      },

      removeAttachment: (index: number) => {
        onAttachmentsChange((prev) => {
          const updated = [...prev];
          const removed = updated.splice(index, 1);
          if (removed[0]?.previewUrl) URL.revokeObjectURL(removed[0].previewUrl);
          return updated;
        });
      },

      processPastedFiles: async (files: File[]) => {
        await processFiles(files);
      },
    }));

    return (
      <div className="relative">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept="image/*,.pdf"
          onChange={(e) => {
            const files = e.target.files;
            // allow selecting the same file again later
            e.target.value = '';
            if (files && files.length > 0) processFiles(files);
          }}
        />

        <button
          type="button"
          onClick={openFilePicker}
          className="p-2 rounded-full hover:bg-primary/10 text-primary transition-all"
          title="Attach files"
        >
          {children}
        </button>
      </div>
    );
  },
);

AttachmentInputArea.displayName = 'AttachmentInputArea';
