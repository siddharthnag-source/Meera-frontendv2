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
  onAttachmentsChange: (attachments: ChatAttachmentInputState[]) => void;
  existingAttachments: ChatAttachmentInputState[];
  maxAttachments: number;
  messageValue: string;
  resetInputHeightState: () => void;
  children?: React.ReactNode;

  // NEW: lets parent disable Send while uploads are running
  onUploadStateChange?: (isUploading: boolean) => void;
}

const MAX_FILE_SIZE_MB = 25;

export const AttachmentInputArea = forwardRef<AttachmentInputAreaRef, Props>(
  (props, ref) => {
    const {
      onAttachmentsChange,
      existingAttachments,
      maxAttachments,
      children,
      onUploadStateChange,
    } = props;

    const fileInputRef = useRef<HTMLInputElement>(null);

    // Support overlapping uploads safely (paste + picker, multiple picks, etc.)
    const uploadCounterRef = useRef(0);
    const setUploading = (val: boolean) => onUploadStateChange?.(val);

    const beginUpload = () => {
      uploadCounterRef.current += 1;
      if (uploadCounterRef.current === 1) setUploading(true);
    };

    const endUpload = () => {
      uploadCounterRef.current = Math.max(0, uploadCounterRef.current - 1);
      if (uploadCounterRef.current === 0) setUploading(false);
    };

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

      beginUpload();

      try {
        const processed: ChatAttachmentInputState[] = [];

        for (const file of fileArray) {
          if (processed.length + existingAttachments.length >= maxAttachments) {
            continue;
          }

          const sizeMb = file.size / (1024 * 1024);
          if (sizeMb > MAX_FILE_SIZE_MB) {
            continue;
          }

          const isImage = file.type.startsWith('image/');
          const type: 'image' | 'document' = isImage ? 'image' : 'document';

          const uploaded = await uploadToSupabase(file);
          if (!uploaded) continue;

          processed.push({
            file,
            previewUrl: URL.createObjectURL(file),
            type,
            storagePath: uploaded.storagePath,
            publicUrl: uploaded.publicUrl,
          });
        }

        if (processed.length > 0) {
          onAttachmentsChange([...existingAttachments, ...processed]);
        }
      } finally {
        endUpload();

        // Critical: allows selecting the same file again to re-trigger onChange
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    const openFilePicker = () => {
      fileInputRef.current?.click();
    };

    useImperativeHandle(ref, () => ({
      clear: () => {
        onAttachmentsChange([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
      },

      removeAttachment: (index: number) => {
        const updated = [...existingAttachments];
        const removed = updated.splice(index, 1);

        if (removed[0]?.previewUrl) {
          URL.revokeObjectURL(removed[0].previewUrl);
        }

        onAttachmentsChange(updated);
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
