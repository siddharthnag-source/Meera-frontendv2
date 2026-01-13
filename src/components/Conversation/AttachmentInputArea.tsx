'use client';

import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { ChatAttachmentInputState } from '@/types/chat';

export interface AttachmentInputAreaRef {
  clear: () => void;
  removeAttachment: (index: number) => void;
  processPastedFiles: (files: File[]) => void;
  openPicker: () => void;
}

interface Props {
  onAttachmentsChange: (attachments: ChatAttachmentInputState[]) => void;
  existingAttachments: ChatAttachmentInputState[];
  maxAttachments: number;
  messageValue: string;
  resetInputHeightState: () => void;
}

const MAX_FILE_SIZE_MB = 25;

export const AttachmentInputArea = forwardRef<AttachmentInputAreaRef, Props>(
  (props, ref) => {
    const { onAttachmentsChange, existingAttachments, maxAttachments } = props;

    const fileInputRef = useRef<HTMLInputElement>(null);

    const uploadToSupabase = async (file: File) => {
      try {
        const ext = file.name.includes('.') ? file.name.split('.').pop() || '' : '';
        const randomSuffix = Math.random().toString(36).slice(2);
        const path = `attachments/${Date.now()}-${randomSuffix}${ext ? '.' + ext : ''}`;

        const { error: uploadError } = await supabase.storage
          .from('attachments')
          .upload(path, file, { upsert: false });

        if (uploadError) {
          console.error('Supabase upload error', uploadError);
          return null;
        }

        const { data } = supabase.storage.from('attachments').getPublicUrl(path);
        const publicUrl = data?.publicUrl || '';

        if (!publicUrl) return null;

        return {
          storagePath: path,
          publicUrl,
        };
      } catch (err) {
        console.error('Upload failed:', err);
        return null;
      }
    };

    const processFiles = async (files: FileList | File[]) => {
      const incoming = Array.isArray(files) ? files : Array.from(files);
      const processed: ChatAttachmentInputState[] = [];

      for (const file of incoming) {
        if (processed.length + existingAttachments.length >= maxAttachments) continue;

        const sizeMb = file.size / (1024 * 1024);
        if (sizeMb > MAX_FILE_SIZE_MB) continue;

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
    };

    const openFilePicker = () => {
      fileInputRef.current?.click();
    };

    useImperativeHandle(ref, () => ({
      clear: () => {
        for (const att of existingAttachments) {
          if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
        }
        onAttachmentsChange([]);
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

      openPicker: () => {
        openFilePicker();
      },
    }));

    return (
      <div className="relative">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept="image/*,application/pdf,.pdf"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) processFiles(files);
            // reset so selecting the same file again triggers onChange
            e.currentTarget.value = '';
          }}
        />

        {/* This button is the one you place beside Send in the keyboard row */}
        <button
          type="button"
          onClick={openFilePicker}
          aria-label="Attach files"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-primary/10 text-primary transition-all"
        >
          {/* Parent should pass an icon as children, e.g. <Paperclip /> */}
          <span className="flex items-center justify-center">{/* @ts-ignore */}</span>
          {/*
            Keep children rendering simple and reliable:
            Conversation can call:
              <AttachmentInputArea ...>
                <Paperclip className="h-5 w-5" />
              </AttachmentInputArea>
          */}
          {/* eslint-disable-next-line react/no-children-prop */}
        </button>
      </div>
    );
  },
);

AttachmentInputArea.displayName = 'AttachmentInputArea';
