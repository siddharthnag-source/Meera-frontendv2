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
  onAttachmentsChange: React.Dispatch<React.SetStateAction<ChatAttachmentInputState[]>>;
  existingAttachments: ChatAttachmentInputState[];
  maxAttachments: number;
  messageValue: string;
  resetInputHeightState: () => void;
  onUploadStateChange?: (isUploading: boolean) => void;
  children?: React.ReactNode;
}

const MAX_FILE_SIZE_MB = 25;
const UPLOADING_PREFIX = '__uploading__';

export const AttachmentInputArea = forwardRef<AttachmentInputAreaRef, Props>(
  (props, ref) => {
    const {
      onAttachmentsChange,
      existingAttachments,
      maxAttachments,
      onUploadStateChange,
      children,
    } = props;

    const fileInputRef = useRef<HTMLInputElement>(null);

    const uploadToSupabase = async (file: File) => {
      try {
        const ext = file.name.split('.').pop() || 'bin';
        const path = `attachments/${Date.now()}-${Math.random()
          .toString(36)
          .substring(2)}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('attachments')
          .upload(path, file, { upsert: false });

        if (uploadError) {
          console.error(uploadError);
          return null;
        }

        const { data } = supabase.storage.from('attachments').getPublicUrl(path);

        return {
          storagePath: path,
          publicUrl: data.publicUrl,
        };
      } catch (err) {
        console.error('Upload failed:', err);
        return null;
      }
    };

    const processFiles = async (files: FileList | File[]) => {
      const fileArray: File[] = Array.isArray(files) ? files : Array.from(files);
      if (fileArray.length === 0) return;

      // capacity guard
      const availableSlots = Math.max(0, maxAttachments - existingAttachments.length);
      const acceptedFiles = fileArray.slice(0, availableSlots);

      // pre-filter by size
      const validFiles = acceptedFiles.filter((file) => {
        const sizeMb = file.size / (1024 * 1024);
        return sizeMb <= MAX_FILE_SIZE_MB;
      });

      if (validFiles.length === 0) return;

      // Create placeholders first (chip appears instantly)
      const placeholders: ChatAttachmentInputState[] = validFiles.map((file) => {
        const isImage = file.type.startsWith('image/');
        const type: 'image' | 'document' = isImage ? 'image' : 'document';
        const tempId = `${UPLOADING_PREFIX}${Date.now()}-${Math.random()
          .toString(36)
          .substring(2)}`;

        return {
          file,
          previewUrl: URL.createObjectURL(file),
          type,
          storagePath: tempId, // placeholder marker
          publicUrl: '', // not uploaded yet
        };
      });

      onAttachmentsChange((prev) => [...prev, ...placeholders]);

      onUploadStateChange?.(true);
      try {
        // Upload sequentially to keep it simple and stable
        for (const placeholder of placeholders) {
          const uploaded = await uploadToSupabase(placeholder.file as File);

          if (!uploaded) {
            // Remove failed placeholder
            onAttachmentsChange((prev) => {
              const next = prev.filter((a) => a.storagePath !== placeholder.storagePath);
              return next;
            });

            if (placeholder.previewUrl) URL.revokeObjectURL(placeholder.previewUrl);
            continue;
          }

          // Replace placeholder with real URLs
          onAttachmentsChange((prev) => {
            const next = prev.map((a) => {
              if (a.storagePath !== placeholder.storagePath) return a;
              return {
                ...a,
                storagePath: uploaded.storagePath,
                publicUrl: uploaded.publicUrl,
              };
            });
            return next;
          });
        }
      } finally {
        onUploadStateChange?.(false);
      }
    };

    const openFilePicker = () => {
      fileInputRef.current?.click();
    };

    useImperativeHandle(ref, () => ({
      clear: () => {
        onAttachmentsChange([]);
      },

      removeAttachment: (index: number) => {
        onAttachmentsChange((prev) => {
          const updated = [...prev];
          const removed = updated.splice(index, 1);

          if (removed[0]?.previewUrl) {
            URL.revokeObjectURL(removed[0].previewUrl);
          }

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
            if (files && files.length > 0) processFiles(files);
            // reset so selecting same file again triggers change
            e.currentTarget.value = '';
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
